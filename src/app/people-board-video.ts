/**
 * People board (video): self-split L→R numbering + per-person zoom MediaPipe Pose raise.
 * No Qwen / cloud face.
 */

import { PoseLandmarker } from "@mediapipe/tasks-vision";
import {
  bindPosesToSeatsByIndex,
  createCountLockState,
  createPoseLandmarker,
  createSeatAnchors,
  dedupePosesByTorso,
  detectPosesMultiBand,
  FirstRaiseTracker,
  FULL_MODEL_URL,
  numberPosesLeftToRight,
  personBoxesFromPoses,
  personBoxesFromSeats,
  runMpOnPersonBoxes,
  SeatRaiseTracker,
  seatsToNumberingSlots,
  slotsFromSort,
  torsoCenter,
  unlockCountLock,
  type CountLockSnapshot,
  type FirstRaiseEvent,
  type NumberingSlot,
  type PersonBox,
  type PoseLandmark,
  type SeatAnchor,
  type SeatRaiseUpdate,
} from "../vision";
import { POSE } from "../vision/detect/isHandRaised";
import { publishClassroomEvent } from "./classroomBus";

const DETECT_INTERVAL_MS = 20;
const DETECT_INTERVAL_LOCKED_MS = 16;
const NUMBERING_MAX_TRIES = 8;
const NUMBERING_RETRY_MS = 400;
/** Strict MediaPipe joint raise — first frame that passes counts. */
const RAISE_MARGIN = 0.025;
const RAISE_MIN_VISIBILITY = 0.25;
const RAISE_MIN_FRAMES = 1;
const RAISE_SCORE_THRESHOLD = 0.015;
const TRACK_MAX_MISSED = 10;
const BUS_SOURCE = "people-video";

const frameCanvas = document.createElement("canvas");
const cropCanvas = document.createElement("canvas");
const bandCanvas = document.createElement("canvas");

type SortedPerson = {
  index: number;
  x: number;
  y: number;
  id?: string | number | null;
  raised?: boolean;
};

const video = document.querySelector<HTMLVideoElement>("#video")!;
const canvas = document.querySelector<HTMLCanvasElement>("#overlay")!;
const ctx = canvas.getContext("2d")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const apiStatusEl = document.querySelector<HTMLElement>("#api-status")!;
const countEl = document.querySelector<HTMLElement>("#count-value")!;
const winnerCard = document.querySelector<HTMLElement>("#winner-card")!;
const winnerValue = document.querySelector<HTMLElement>("#winner-value")!;
const listEl = document.querySelector<HTMLOListElement>("#number-list")!;
const fileNameEl = document.querySelector<HTMLElement>("#file-name")!;
const timeLabelEl = document.querySelector<HTMLElement>("#time-label")!;
const inputVideo = document.querySelector<HTMLInputElement>("#input-video")!;
const seekEl = document.querySelector<HTMLInputElement>("#seek")!;
const btnStart = document.querySelector<HTMLButtonElement>("#btn-start")!;
const btnPause = document.querySelector<HTMLButtonElement>("#btn-pause")!;
const btnStop = document.querySelector<HTMLButtonElement>("#btn-stop")!;
const btnReset = document.querySelector<HTMLButtonElement>("#btn-reset")!;
const btnRelock = document.querySelector<HTMLButtonElement>("#btn-relock")!;
const inputExpected = document.querySelector<HTMLInputElement>("#input-expected")!;
const loadOverlay = document.querySelector<HTMLElement>("#load-overlay")!;
const loadTitle = document.querySelector<HTMLElement>("#load-title")!;
const loadDetail = document.querySelector<HTMLElement>("#load-detail")!;

const HEALTH_URL = "/api/health";

let objectUrl: string | null = null;
let detecting = false;
let modelsReady = false;
let modelsPromise: Promise<void> | null = null;
let videoReady = false;
let landmarker: PoseLandmarker | null = null;
let raf = 0;
let lastTs = 0;
let lastPersonCrops: PersonBox[] = [];
let canvasSized = false;
let race = new FirstRaiseTracker();
let countLock: CountLockSnapshot = createCountLockState();
let numberingSlots: NumberingSlot[] = [];
let seatAnchors: SeatAnchor[] = [];
let seatRaiseByIndex = new Map<number, SeatRaiseTracker>();
let lastRaiseByIndex = new Map<number, SeatRaiseUpdate>();
let lockedPeople: SortedPerson[] = [];
let detectInFlight = false;
let lastUiKey = "";
let lastWinnerKey = "";
let seeking = false;
let numberingPhase = false;

function readExpectedCount(): number {
  const n = Number(inputExpected.value);
  if (!Number.isFinite(n)) return 2;
  return Math.min(6, Math.max(1, Math.round(n)));
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function hasVideoFile(): boolean {
  return !!(objectUrl || video.src);
}

function showLoadOverlay(title: string, detail: string, isError = false): void {
  loadTitle.textContent = title;
  loadDetail.textContent = detail;
  loadOverlay.hidden = false;
  loadOverlay.classList.toggle("is-error", isError);
}

function hideLoadOverlay(): void {
  loadOverlay.hidden = true;
  loadOverlay.classList.remove("is-error");
}

function syncStartEnabled(): void {
  const canStart = modelsReady && videoReady && hasVideoFile() && !detecting;
  btnStart.disabled = !canStart;
  seekEl.disabled = !videoReady || !hasVideoFile();
}

function refreshIdlePrompt(): void {
  if (detecting) return;
  if (!modelsReady) {
    showLoadOverlay("正在加载检测模型…", "MediaPipe Pose 多人检测 + 局部放大举手");
    return;
  }
  if (hasVideoFile() && !videoReady) {
    showLoadOverlay("正在加载视频…", fileNameEl.textContent || "请稍候");
    setStatus("视频加载中，完成后才能开始检测");
    return;
  }
  hideLoadOverlay();
  if (hasVideoFile() && videoReady) {
    setStatus("加载完成 · 可以开始检测（本地分割编号，无需千问）");
  } else {
    setStatus("模型已就绪 · 请选择本地视频");
  }
  syncStartEnabled();
}

function setApiStatus(ok: boolean, detail?: string): void {
  apiStatusEl.textContent = ok
    ? `服务: 已连接${detail ? ` · ${detail}` : " · 本地 MediaPipe 编号"}`
    : `服务: ${detail ?? "可选"}`;
  apiStatusEl.classList.toggle("ok", ok);
  apiStatusEl.classList.toggle("bad", !ok);
}

function ensureCanvasSize(): boolean {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return false;
  if (!canvasSized || canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    canvasSized = true;
  }
  return true;
}

async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(HEALTH_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    setApiStatus(true, "本地分割");
    return true;
  } catch {
    setApiStatus(true, "本地分割（API 未启动也可编号举手）");
    return false;
  }
}

function scoutPoses() {
  if (!landmarker) return [];
  const raw = detectPosesMultiBand(landmarker, video, frameCanvas, bandCanvas);
  return dedupePosesByTorso(raw, {
    minDistance: 0.09,
    minSeparationX: 0.045,
    yWeight: 0.45,
  });
}

function applyLockFromIndexed(
  numbered: { index: number; x: number; y: number; landmarks: readonly PoseLandmark[] }[],
): void {
  numberingSlots = slotsFromSort(
    numbered.map((p) => ({ index: p.index, x: p.x, y: p.y, id: p.index })),
  );
  seatAnchors = createSeatAnchors(numberingSlots, { minFrames: RAISE_MIN_FRAMES });
  numberingSlots = seatsToNumberingSlots(seatAnchors);
  lockedPeople = numbered.map((p) => ({
    index: p.index,
    x: p.x,
    y: p.y,
    id: p.index,
    raised: false,
  }));
  seatRaiseByIndex = new Map(
    seatAnchors.map((s) => [
      s.index,
      new SeatRaiseTracker({
        minFrames: RAISE_MIN_FRAMES,
        scoreThreshold: RAISE_SCORE_THRESHOLD,
        smoothAlpha: 0.4,
        raiseOptions: {
          classroom: true,
          margin: RAISE_MARGIN,
          minVisibility: RAISE_MIN_VISIBILITY,
        },
      }),
    ]),
  );
  lastRaiseByIndex = new Map();
}

function peopleFromSeats(seats: SeatAnchor[]): SortedPerson[] {
  return seats.map((s) => ({
    index: s.index,
    x: s.x,
    y: s.y,
    id: s.index,
    raised: lastRaiseByIndex.get(s.index)?.raised ?? false,
  }));
}

function updateSeatRaises(seats: SeatAnchor[], nowMs: number): void {
  const withLm = seats.filter((s) => s.landmarks);
  for (const seat of seats) {
    const tracker = seatRaiseByIndex.get(seat.index);
    if (!tracker) continue;
    const neighborLms = withLm
      .filter((s) => s.index !== seat.index)
      .map((s) => s.landmarks!);
    const upd = tracker.update(seat.landmarks, nowMs, neighborLms);
    lastRaiseByIndex.set(seat.index, upd);
  }
}

function indexedPosesFromCascade(
  poses: readonly { box: PersonBox; landmarks: readonly PoseLandmark[] }[],
): Array<{ index: number; x: number; y: number; landmarks: readonly PoseLandmark[] }> {
  const out: Array<{
    index: number;
    x: number;
    y: number;
    landmarks: readonly PoseLandmark[];
  }> = [];
  for (const p of poses) {
    const index = p.box.index;
    if (index == null) continue;
    const c = torsoCenter(p.landmarks);
    const nose = p.landmarks[POSE.NOSE];
    const vis = nose?.visibility ?? 1;
    const x = nose && vis >= 0.25 ? nose.x : c.x;
    const y = nose && vis >= 0.25 ? nose.y : Math.max(0, c.y - 0.1);
    out.push({ index, x, y, landmarks: p.landmarks });
  }
  return out;
}

async function lockNumbering(
  numbered: { index: number; x: number; y: number; landmarks: readonly PoseLandmark[] }[],
): Promise<void> {
  if (countLock.locked) return;
  countLock = { locked: true, streak: 1, lastCount: numbered.length };
  applyLockFromIndexed(numbered);
  race = new FirstRaiseTracker();
  race.update(
    numbered.map((f) => ({ personIndex: f.index, raised: false })),
    performance.now(),
  );
  lastUiKey = "";
  lastWinnerKey = "";
  publishClassroomEvent({
    type: "numbering-locked",
    seats: numbered.map((f) => f.index),
    source: BUS_SOURCE,
  });
  setStatus(
    `已锁定 ${numbered.length} 人（左→右自分割）· 近距已切开局部放大 · MediaPipe 举手`,
  );
}

/**
 * Pause, scout multi-person Pose, L→R number, lock when count matches.
 */
async function awaitInitialNumbering(opts?: { rewind?: boolean }): Promise<boolean> {
  const expected = readExpectedCount();
  numberingPhase = true;
  showLoadOverlay("正在本地分割编号", `多人 Pose 检测 · 需要 ${expected} 人 · 完成前不检测举手`);
  setStatus(`编号中 · 需要 ${expected} 人 · 编号锁定前不检测举手`);

  video.pause();
  if (opts?.rewind !== false) {
    video.currentTime = 0;
    await waitSeeked();
  }
  if (!ensureCanvasSize()) {
    numberingPhase = false;
    showLoadOverlay("编号失败", "无法读取视频尺寸", true);
    return false;
  }

  for (let attempt = 1; attempt <= NUMBERING_MAX_TRIES; attempt++) {
    if (!detecting) {
      numberingPhase = false;
      return false;
    }
    showLoadOverlay(
      "正在本地分割编号",
      `第 ${attempt}/${NUMBERING_MAX_TRIES} 次 · 需要 ${expected} 人 · 近距自动切开`,
    );
    const scout = scoutPoses();
    const numbered = numberPosesLeftToRight(scout, expected);
    if (numbered.length >= expected) {
      const take = numbered.slice(0, expected);
      // Isolate close people, zoom each crop, refine joints before lock.
      const boxes = personBoxesFromPoses(take);
      const cascade = runMpOnPersonBoxes({
        landmarker: landmarker!,
        frameCanvas,
        cropCanvas,
        source: video,
        boxes,
      });
      lastPersonCrops = cascade.boxes;
      const refined = indexedPosesFromCascade(cascade.poses);
      const byIndex = new Map(refined.map((p) => [p.index, p]));
      const locked = take.map((p) => byIndex.get(p.index) ?? p);
      await lockNumbering(locked);
      numberingPhase = false;
      hideLoadOverlay();
      setStatus(`编号已确认 ${expected} 人（左→右）· 开始举手检测`);
      return true;
    }
    setStatus(`检出 ${numbered.length}/${expected} 人 · 重试 ${attempt}/${NUMBERING_MAX_TRIES}`);
    await sleep(NUMBERING_RETRY_MS);
  }

  numberingPhase = false;
  showLoadOverlay(
    "编号未完成",
    `未能稳定检出 ${expected} 人。请核对「需要人数」或换一帧后再试。`,
    true,
  );
  setStatus(`编号未完成 · 需要 ${expected} 人 · 未开始举手检测`);
  return false;
}

function renderWinner(winner: FirstRaiseEvent | null): void {
  const key = winner ? String(winner.personIndex) : "";
  if (key === lastWinnerKey) return;
  lastWinnerKey = key;
  if (winner) {
    winnerValue.textContent = `#${winner.personIndex}`;
    winnerCard.classList.add("has-winner");
    winnerValue.style.animation = "none";
    void winnerValue.offsetWidth;
    winnerValue.style.animation = "";
    publishClassroomEvent({
      type: "first-raise",
      personIndex: winner.personIndex,
      source: BUS_SOURCE,
    });
  } else {
    winnerValue.textContent = "—";
    winnerCard.classList.remove("has-winner");
    winnerValue.style.animation = "";
  }
}

function renderHud(
  liveCount: number,
  people: SortedPerson[],
  winner: FirstRaiseEvent | null,
  locked: boolean,
): void {
  const key = `${locked ? 1 : 0}:${liveCount}:${people
    .map((p) => `${p.index}:${p.raised ? 1 : 0}`)
    .join(",")}:w${winner?.personIndex ?? "-"}`;
  if (key === lastUiKey) return;
  lastUiKey = key;

  countEl.textContent = String(locked ? people.length || lockedPeople.length : liveCount);
  listEl.innerHTML = "";
  const display = locked
    ? lockedPeople.map((base) => {
        const live = people.find((p) => p.index === base.index);
        return { ...base, raised: live?.raised ?? false };
      })
    : [];

  for (const p of display) {
    const li = document.createElement("li");
    const isWinner = winner?.personIndex === p.index;
    if (isWinner) li.textContent = `${p.index} 最先`;
    else if (p.raised) li.textContent = `${p.index} 举手`;
    else li.textContent = String(p.index);
    li.classList.toggle("raised", !!p.raised && !isWinner);
    li.classList.toggle("winner", isWinner);
    listEl.appendChild(li);
  }
  renderWinner(winner);
}

function drawPersonCrops(boxes: readonly PersonBox[], w: number, h: number): void {
  if (boxes.length === 0) return;
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(240, 180, 41, 0.8)";
  ctx.font = "12px Segoe UI, sans-serif";
  ctx.fillStyle = "rgba(240, 180, 41, 0.95)";
  for (const b of boxes) {
    const x = b.xMin * w;
    const y = b.yMin * h;
    ctx.strokeRect(x, y, (b.xMax - b.xMin) * w, (b.yMax - b.yMin) * h);
    const label = b.index != null ? `放大 #${b.index}` : "放大";
    ctx.fillText(label, x + 4, Math.max(14, y - 4));
  }
  ctx.restore();
}

function drawOverlay(
  people: SortedPerson[],
  winner: FirstRaiseEvent | null,
  locked: boolean,
): void {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  drawPersonCrops(lastPersonCrops, w, h);
  if (!locked) return;

  for (const seat of seatAnchors) {
    const index = seat.index;
    const isWinner = winner != null && index === winner.personIndex;
    const raised = lastRaiseByIndex.get(index)?.raised ?? false;
    const ls = seat.landmarks?.[POSE.LEFT_SHOULDER];
    const rs = seat.landmarks?.[POSE.RIGHT_SHOULDER];
    if (ls && rs) {
      ctx.strokeStyle = isWinner ? "#f0b429" : raised ? "#2dd4a8" : "#3d9cfd";
      ctx.lineWidth = isWinner ? 5 : 3;
      ctx.beginPath();
      ctx.moveTo(ls.x * w, ls.y * h);
      ctx.lineTo(rs.x * w, rs.y * h);
      ctx.stroke();
    }
    ctx.fillStyle = isWinner ? "#f0b429" : raised ? "#2dd4a8" : "#e7ecf1";
    ctx.font = "bold 28px Segoe UI, sans-serif";
    const text = isWinner ? `#${index} 最先` : raised ? `#${index} 举手` : `#${index}`;
    ctx.fillText(text, seat.x * w - 14, seat.y * h - 16);
  }
  void people;
}

function clearNumberingLock(): void {
  countLock = unlockCountLock(countLock);
  numberingSlots = [];
  seatAnchors = [];
  seatRaiseByIndex = new Map();
  lastRaiseByIndex = new Map();
  lockedPeople = [];
  lastPersonCrops = [];
  race = new FirstRaiseTracker();
  lastUiKey = "";
  renderWinner(null);
  publishClassroomEvent({ type: "numbering-cleared", source: BUS_SOURCE });
}

async function loop(nowMs: number): Promise<void> {
  raf = requestAnimationFrame((t) => void loop(t));
  if (!detecting || !modelsReady || !landmarker || video.readyState < 2) return;
  if (video.paused || video.ended || seeking) {
    updateTimeUi();
    return;
  }
  if (!ensureCanvasSize()) return;
  const interval = countLock.locked ? DETECT_INTERVAL_LOCKED_MS : DETECT_INTERVAL_MS;
  if (nowMs - lastTs < interval) return;
  lastTs = nowMs;
  if (detectInFlight) return;
  detectInFlight = true;
  try {
    if (numberingPhase || !countLock.locked) {
      updateTimeUi();
      renderHud(0, [], null, false);
      drawOverlay([], null, false);
      if (numberingPhase) {
        setStatus(`本地编号中 · 需要 ${readExpectedCount()} 人 · 编号锁定前不检测举手`);
      }
      return;
    }

    // Per locked seat: isolate close people, zoom crop, single-person Pose.
    const boxes = personBoxesFromSeats(seatAnchors);
    const cascade = runMpOnPersonBoxes({
      landmarker,
      frameCanvas,
      cropCanvas,
      source: video,
      boxes,
    });
    lastPersonCrops = cascade.boxes;
    const indexedPoses = indexedPosesFromCascade(cascade.poses);
    seatAnchors = bindPosesToSeatsByIndex(seatAnchors, indexedPoses, {
      maxMissed: TRACK_MAX_MISSED,
    });
    numberingSlots = seatsToNumberingSlots(seatAnchors);
    updateSeatRaises(seatAnchors, nowMs);

    const people = peopleFromSeats(seatAnchors);
    const liveSeats = people.filter((p) =>
      seatAnchors.find((s) => s.index === p.index)?.landmarks,
    ).length;

    race.update(
      seatAnchors.map((s) => {
        const u = lastRaiseByIndex.get(s.index);
        return {
          personIndex: s.index,
          raised: !!u?.raised,
          score: u?.score ?? 0,
          edgeAtMs: u?.edgeAtMs,
        };
      }),
      nowMs,
    );
    const winner = race.winner;
    renderHud(liveSeats, people, winner, true);
    drawOverlay(people, winner, true);
    updateTimeUi();

    const raisedIndexes = people.filter((p) => p.raised).map((p) => p.index);
    const missed = seatAnchors.filter((s) => !s.fresh).length;
    if (winner) {
      setStatus(`最先举手：#${winner.personIndex} · 「下一轮」再赛 · 「重新编号」可重排`);
    } else if (missed > 0) {
      setStatus(`座位锁定 ${people.length} · 在场 ${liveSeats} · ${missed} 座短暂丢失`);
    } else if (raisedIndexes.length === 0) {
      setStatus(`座位锁定 ${people.length} 人 · 近距切开放大 · 严格举手判定 · 等待举手…`);
    } else {
      setStatus(`举手中：${raisedIndexes.map((n) => `#${n}`).join("、")}`);
    }
  } finally {
    detectInFlight = false;
  }
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function updateTimeUi(): void {
  const cur = video.currentTime || 0;
  const dur = video.duration || 0;
  timeLabelEl.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
  if (!seeking && Number.isFinite(dur) && dur > 0) {
    seekEl.max = String(dur);
    seekEl.value = String(cur);
  }
}

function waitSeeked(): Promise<void> {
  return new Promise((resolve) => {
    if (!seeking && video.seeking === false) {
      resolve();
      return;
    }
    const done = () => {
      video.removeEventListener("seeked", done);
      resolve();
    };
    video.addEventListener("seeked", done);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function setRaiseButtonsEnabled(on: boolean): void {
  btnPause.disabled = !on;
  btnReset.disabled = !on;
  btnRelock.disabled = !on;
}

function revokeObjectUrl(): void {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

function onFileSelected(): void {
  const file = inputVideo.files?.[0];
  stopDetection({ keepFile: false, keepModels: true });
  revokeObjectUrl();
  video.removeAttribute("src");
  video.load();
  videoReady = false;
  canvasSized = false;
  if (!file) {
    fileNameEl.textContent = "未选择文件";
    refreshIdlePrompt();
    return;
  }
  fileNameEl.textContent = file.name;
  objectUrl = URL.createObjectURL(file);
  video.src = objectUrl;
  showLoadOverlay("正在加载视频…", file.name);
  setStatus("视频加载中…");
  syncStartEnabled();
}

async function preloadModels(): Promise<void> {
  if (modelsReady) return;
  if (modelsPromise) return modelsPromise;
  modelsPromise = (async () => {
    try {
      showLoadOverlay("正在加载检测模型…", "MediaPipe Pose Full（多人 + 局部放大）");
      setStatus("正在加载 MediaPipe Pose…");
      syncStartEnabled();
      await checkHealth();
      landmarker = await createPoseLandmarker({
        numPoses: 6,
        runningMode: "IMAGE",
        modelAssetPath: FULL_MODEL_URL,
        minPoseDetectionConfidence: 0.4,
        minPosePresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
      });
      modelsReady = true;
      refreshIdlePrompt();
    } catch (err) {
      console.error(err);
      modelsReady = false;
      landmarker?.close();
      landmarker = null;
      modelsPromise = null;
      const msg = err instanceof Error ? err.message : "模型加载失败";
      showLoadOverlay("检测模型加载失败", msg, true);
      setStatus(`模型加载失败：${msg}`);
      syncStartEnabled();
    }
  })();
  return modelsPromise;
}

async function onStart(): Promise<void> {
  if (!hasVideoFile()) {
    setStatus("请先选择视频文件");
    return;
  }
  if (!modelsReady || !landmarker) {
    setStatus("Pose 尚未就绪，请稍候");
    await preloadModels();
    if (!modelsReady || !landmarker) return;
  }
  if (!videoReady || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
    setStatus("视频尚未加载完成，请稍候");
    showLoadOverlay("正在加载视频…", fileNameEl.textContent || "请稍候");
    return;
  }
  btnStart.disabled = true;
  try {
    clearNumberingLock();
    lastTs = 0;
    canvasSized = false;
    detecting = true;
    btnStop.disabled = false;
    setRaiseButtonsEnabled(false);
    cancelAnimationFrame(raf);
    raf = 0;

    const numbered = await awaitInitialNumbering({ rewind: true });
    if (!detecting) return;
    if (!numbered) {
      detecting = false;
      video.pause();
      btnStop.disabled = true;
      setRaiseButtonsEnabled(false);
      syncStartEnabled();
      return;
    }

    video.currentTime = 0;
    await waitSeeked();
    await video.play();
    btnPause.textContent = "暂停视频";
    setRaiseButtonsEnabled(true);
    setStatus(`编号已确认 ${readExpectedCount()} 人（左→右）· 举手检测已开始`);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame((t) => void loop(t));
  } catch (err) {
    console.error(err);
    numberingPhase = false;
    detecting = false;
    setStatus(err instanceof Error ? err.message : "启动失败");
    syncStartEnabled();
  }
}

function stopDetection(opts?: { keepFile?: boolean; keepModels?: boolean }): void {
  cancelAnimationFrame(raf);
  raf = 0;
  detecting = false;
  numberingPhase = false;
  video.pause();
  if (!opts?.keepModels) {
    landmarker?.close();
    landmarker = null;
    modelsReady = false;
    modelsPromise = null;
  }
  clearNumberingLock();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  renderHud(0, [], null, false);
  btnStop.disabled = true;
  btnPause.disabled = true;
  btnReset.disabled = true;
  btnRelock.disabled = true;
  btnPause.textContent = "暂停视频";
  if (!opts?.keepFile) videoReady = false;
  syncStartEnabled();
  if (modelsReady && hasVideoFile() && videoReady) {
    hideLoadOverlay();
    setStatus("已停止检测 · 可再次「开始检测」");
  } else {
    refreshIdlePrompt();
  }
}

function onStop(): void {
  stopDetection({ keepFile: true, keepModels: true });
}

function onTogglePause(): void {
  if (!detecting || numberingPhase || !countLock.locked) return;
  if (video.paused) {
    void video.play().then(() => {
      btnPause.textContent = "暂停视频";
      setStatus("继续播放 · 检测中");
    });
  } else {
    video.pause();
    btnPause.textContent = "继续播放";
    setStatus("视频已暂停 · 检测暂挂");
  }
}

function onResetRound(): void {
  if (!countLock.locked || numberingPhase) return;
  race.reset();
  lastUiKey = "";
  renderWinner(null);
  publishClassroomEvent({ type: "race-reset", source: BUS_SOURCE });
  setStatus("已重置本轮 · 编号保持 · 等待最先举手");
}

function onRelock(): void {
  if (!detecting || numberingPhase) return;
  void (async () => {
    cancelAnimationFrame(raf);
    raf = 0;
    clearNumberingLock();
    const ok = await awaitInitialNumbering({ rewind: false });
    if (!detecting) return;
    if (!ok) {
      detecting = false;
      video.pause();
      btnStop.disabled = true;
      setRaiseButtonsEnabled(false);
      syncStartEnabled();
      return;
    }
    await video.play();
    btnPause.textContent = "暂停视频";
    setRaiseButtonsEnabled(true);
    setStatus(`编号已重新确认 ${readExpectedCount()} 人（左→右）· 举手检测已开始`);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame((t) => void loop(t));
  })();
}

inputVideo.addEventListener("change", onFileSelected);
btnStart.addEventListener("click", () => void onStart());
btnPause.addEventListener("click", onTogglePause);
btnStop.addEventListener("click", onStop);
btnReset.addEventListener("click", onResetRound);
btnRelock.addEventListener("click", onRelock);

seekEl.addEventListener("pointerdown", () => {
  seeking = true;
});
seekEl.addEventListener("input", () => {
  const t = Number(seekEl.value);
  if (Number.isFinite(t)) video.currentTime = t;
  updateTimeUi();
});
seekEl.addEventListener("change", () => {
  seeking = false;
  updateTimeUi();
  if (!detecting) return;
  void (async () => {
    cancelAnimationFrame(raf);
    raf = 0;
    clearNumberingLock();
    const ok = await awaitInitialNumbering({ rewind: false });
    if (!detecting) return;
    if (!ok) {
      detecting = false;
      video.pause();
      btnStop.disabled = true;
      setRaiseButtonsEnabled(false);
      syncStartEnabled();
      return;
    }
    await video.play();
    btnPause.textContent = "暂停视频";
    setRaiseButtonsEnabled(true);
    setStatus(`编号已确认 ${readExpectedCount()} 人（左→右）· 举手检测已开始`);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame((t) => void loop(t));
  })();
});

video.addEventListener("loadedmetadata", () => {
  seekEl.max = String(video.duration || 0);
  updateTimeUi();
  canvasSized = false;
});
video.addEventListener("canplay", () => {
  if (!hasVideoFile()) return;
  videoReady = true;
  refreshIdlePrompt();
});
video.addEventListener("loadeddata", () => {
  if (!hasVideoFile()) return;
  if (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
    videoReady = true;
    refreshIdlePrompt();
  }
});
video.addEventListener("error", () => {
  videoReady = false;
  btnStart.disabled = true;
  showLoadOverlay("视频加载失败", "请换一个文件再试", true);
  setStatus("视频加载失败 · 请重新选择文件");
});
video.addEventListener("timeupdate", updateTimeUi);
video.addEventListener("ended", () => {
  btnPause.textContent = "继续播放";
});

void preloadModels();
