/**
 * People board (video file path):
 * Same lock / face-seat / raise logic as people-fast, but source is a local video file.
 */

import { PoseLandmarker } from "@mediapipe/tasks-vision";
import {
  countSlotsWithFace,
  createCountLockState,
  createPoseLandmarker,
  createSeatAnchors,
  FirstRaiseTracker,
  FULL_MODEL_URL,
  bindPosesToSeatsByIndex,
  followLockedFaces,
  matchFacesToIds,
  numberFacesLeftToRight,
  nudgeLockedFacesTowardHeads,
  PoseTracker,
  runQwenMpCascade,
  SeatRaiseTracker,
  seatsToNumberingSlots,
  shouldPollVisionFaces,
  slotsFromSort,
  torsoCenter,
  unlockCountLock,
  type CountLockSnapshot,
  type FaceBox,
  type FaceDescriptor,
  type FirstRaiseEvent,
  type NumberedFace,
  type NumberingSlot,
  type PersonBox,
  type PoseLandmark,
  type SeatAnchor,
  type SeatRaiseUpdate,
  type TrackedPose,
} from "../vision";
import { POSE } from "../vision/detect/isHandRaised";
import { publishClassroomEvent } from "./classroomBus";
import { detectFacesViaQwen, fetchQwenFaceStatus } from "./qwenFaceDetect";

const DETECT_INTERVAL_MS = 55;
const DETECT_INTERVAL_LOCKED_MS = 48;
const FACE_DETECT_INTERVAL_MS = 900;
const FACE_DETECT_INTERVAL_LOCKED_MS = 1600;
const NUMBERING_MAX_TRIES = 6;
const NUMBERING_RETRY_MS = 700;
const RAISE_MARGIN = 0.028;
const RAISE_MIN_VISIBILITY = 0.22;
const RAISE_MIN_FRAMES = 1;
const RAISE_SCORE_THRESHOLD = 0.014;
/** Prefer horizontal seat lock; avoid stealing a neighbor track. */
const TRACK_MATCH_DISTANCE = 0.16;
const TRACK_MATCH_Y_WEIGHT = 0.35;
/** Drop unmatched ghosts, but keep a short grace for brief dropouts. */
const TRACK_MAX_MISSED = 10;
const BUS_SOURCE = "people-video";

const frameCanvas = document.createElement("canvas");
const cropCanvas = document.createElement("canvas");

type SortedPerson = {
  index: number;
  x: number;
  y: number;
  id?: string | number | null;
  raised?: boolean;
};

type SortResponse = {
  count: number;
  people: SortedPerson[];
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
let qwenFaceOk = false;
let faceInFlight = false;
let raf = 0;
let lastTs = 0;
let lastFaceTs = 0;
let lastFaceByTrack = new Map<number, FaceDescriptor>();
let lastFaceBoxes: FaceBox[] = [];
let lastNumberedFaces: NumberedFace[] = [];
let lastPersonCrops: PersonBox[] = [];
let faceBySeatIndex = new Map<number, FaceBox>();
let canvasSized = false;
let apiOk = false;
let tracker = new PoseTracker({
  matchDistance: TRACK_MATCH_DISTANCE,
  matchYWeight: TRACK_MATCH_Y_WEIGHT,
  maxMissed: TRACK_MAX_MISSED,
  minFrames: RAISE_MIN_FRAMES,
});
let race = new FirstRaiseTracker();
let countLock: CountLockSnapshot = createCountLockState();
let numberingSlots: NumberingSlot[] = [];
/** After lock: stable seat identity (index never changes with MediaPipe track churn). */
let seatAnchors: SeatAnchor[] = [];
let seatRaiseByIndex = new Map<number, SeatRaiseTracker>();
let lastRaiseByIndex = new Map<number, SeatRaiseUpdate>();
let lockedPeople: SortedPerson[] = [];
let sortInFlight = false;
let detectInFlight = false;
let lastUiKey = "";
let lastWinnerKey = "";
let seeking = false;
/** True while Qwen numbering is required and raise detection must not run. */
let numberingPhase = false;

function seatHeadAnchor(seat: SeatAnchor): { x: number; y: number } {
  const nose = seat.landmarks?.[POSE.NOSE];
  if (nose && (nose.visibility ?? 1) >= 0.35) {
    return { x: nose.x, y: nose.y };
  }
  return { x: seat.x, y: Math.max(0, seat.y - 0.12) };
}

function commitLockedFaces(faces: readonly NumberedFace[]): void {
  lastNumberedFaces = [...faces].sort((a, b) => a.index - b.index);
  faceBySeatIndex = new Map(lastNumberedFaces.map((f) => [f.index, f]));
  if (seatAnchors.length === 0) return;
  seatAnchors = seatAnchors.map((s) => {
    const f = faceBySeatIndex.get(s.index);
    if (!f) return s;
    return { ...s, x: f.cx, y: f.cy, debouncer: s.debouncer };
  });
}

function applyQwenFaces(faces: FaceBox[], expected: number): NumberedFace[] {
  lastFaceBoxes = faces;
  if (countLock.locked && lastNumberedFaces.length > 0) {
    // Identity is frozen at lock. New Qwen boxes only follow the previous face.
    commitLockedFaces(followLockedFaces(lastNumberedFaces, faces));
    numberingSlots = seatsToNumberingSlots(seatAnchors);
    return lastNumberedFaces;
  }

  const numbered = numberFacesLeftToRight(faces, expected);
  lastNumberedFaces = numbered;
  faceBySeatIndex = new Map(numbered.map((f) => [f.index, f]));
  return numbered;
}

function bindFaceTemplatesToSeats(): number {
  if (seatAnchors.length === 0 || lastFaceBoxes.length === 0) {
    return countSlotsWithFace(numberingSlots);
  }
  const matched = matchFacesToIds(
    video,
    seatAnchors.map((s) => {
      const h = seatHeadAnchor(s);
      return { trackId: s.index, x: h.x, y: h.y, template: s.faceDescriptor };
    }),
    lastFaceBoxes,
  );
  lastFaceByTrack = new Map();
  for (const seat of seatAnchors) {
    const hit = matched.get(seat.index);
    if (!hit) continue;
    seat.faceDescriptor = hit.descriptor;
    lastFaceByTrack.set(seat.index, hit.descriptor);
  }
  numberingSlots = seatsToNumberingSlots(seatAnchors);
  return countSlotsWithFace(numberingSlots);
}

function pollQwenNumbering(nowMs: number, expected: number, force = false): void {
  if (!qwenFaceOk) return;
  if (
    !shouldPollVisionFaces({
      force,
      nowMs,
      lastFaceTs,
      minIntervalMs: countLock.locked ? FACE_DETECT_INTERVAL_LOCKED_MS : FACE_DETECT_INTERVAL_MS,
      inFlight: faceInFlight,
    })
  ) {
    return;
  }
  faceInFlight = true;
  lastFaceTs = nowMs;
  void detectFacesViaQwen(video, { maxFaces: expected })
    .then((faces) => {
      if (!detecting) return;
      const numbered = applyQwenFaces(faces, expected);
      if (!countLock.locked && numbered.length === expected && !sortInFlight) {
        void lockNumberingFromQwen(numbered);
      }
    })
    .catch((err) => {
      console.warn("[face/qwen]", err);
    })
    .finally(() => {
      faceInFlight = false;
    });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitSeeked(): Promise<void> {
  if (!video.seeking) return;
  await new Promise<void>((resolve) => {
    video.addEventListener("seeked", () => resolve(), { once: true });
  });
}

async function ensureVideoFrame(): Promise<boolean> {
  if (video.readyState < 2) {
    try {
      await video.play();
      video.pause();
    } catch {
      return false;
    }
  }
  return ensureCanvasSize();
}

function setRaiseButtonsEnabled(enabled: boolean): void {
  btnPause.disabled = !enabled;
  btnReset.disabled = !enabled;
  btnRelock.disabled = !enabled;
}

/**
 * Pause the video, run Qwen until expected faces are numbered left→right, then lock.
 * Raise detection must not start until this returns true.
 */
async function awaitInitialNumbering(opts?: { rewind?: boolean }): Promise<boolean> {
  const expected = readExpectedCount();
  numberingPhase = true;
  setRaiseButtonsEnabled(false);
  showLoadOverlay("正在千问编号", `检测人脸并按左→右排序 · 需要 ${expected} 人 · 完成前不检测举手`);
  setStatus(`千问编号中 · 需要 ${expected} 人 · 编号锁定前不检测举手`);

  if (opts?.rewind !== false) {
    video.pause();
    video.currentTime = 0;
    await waitSeeked();
  } else {
    video.pause();
  }
  if (!(await ensureVideoFrame())) {
    showLoadOverlay("无法读取画面", "请确认视频已加载完成", true);
    numberingPhase = false;
    return false;
  }

  for (let attempt = 1; attempt <= NUMBERING_MAX_TRIES && detecting; attempt++) {
    showLoadOverlay(
      "正在千问编号",
      `第 ${attempt}/${NUMBERING_MAX_TRIES} 次 · 左→右 · 需要 ${expected} 人`,
    );
    setStatus(`千问编号中 ${attempt}/${NUMBERING_MAX_TRIES} · 需要 ${expected} 人 · 请稍候`);
    try {
      faceInFlight = true;
      lastFaceTs = performance.now();
      const faces = await detectFacesViaQwen(video, { maxFaces: expected });
      if (!detecting) return false;
      const numbered = applyQwenFaces(faces, expected);
      renderHud(numbered.length, [], null, false);
      drawOverlay([], [], null, false);
      if (numbered.length === expected) {
        await lockNumberingFromQwen(numbered);
        if (!detecting || !countLock.locked) return false;
        numberingPhase = false;
        hideLoadOverlay();
        setRaiseButtonsEnabled(true);
        setStatus(`编号已确认 ${expected} 人（左→右）· 开始举手检测`);
        return true;
      }
      showLoadOverlay(
        "人数未齐",
        `千问见到 ${numbered.length}/${expected} 人，继续识别…`,
      );
    } catch (err) {
      console.warn("[face/qwen] numbering", err);
      const msg = err instanceof Error ? err.message : "识别失败";
      showLoadOverlay("千问编号失败", `${msg} · 正在重试…`);
    } finally {
      faceInFlight = false;
    }
    if (attempt < NUMBERING_MAX_TRIES && detecting) await sleep(NUMBERING_RETRY_MS);
  }

  numberingPhase = false;
  if (!detecting) return false;
  showLoadOverlay(
    "编号未完成",
    `未能识别到 ${expected} 人。请核对「需要人数」或画面后再点「开始检测」。`,
    true,
  );
  setStatus(`编号未完成 · 需要 ${expected} 人 · 未开始举手检测`);
  return false;
}

/** Keep Qwen seat numbers on cascade crops; never re-rank by torso x. */
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
  const canStart = modelsReady && qwenFaceOk && videoReady && hasVideoFile() && !detecting;
  btnStart.disabled = !canStart;
  seekEl.disabled = !videoReady || !hasVideoFile();
}

function refreshIdlePrompt(): void {
  if (detecting) return;
  if (!modelsReady) {
    showLoadOverlay("正在加载检测模型…", loadDetail.textContent || "请稍候，加载完成前不能开始检测");
    return;
  }
  if (hasVideoFile() && !videoReady) {
    showLoadOverlay("正在加载视频…", fileNameEl.textContent || "请稍候");
    setStatus("视频加载中，完成后才能开始检测");
    return;
  }
  hideLoadOverlay();
  if (hasVideoFile() && videoReady) {
    setStatus("加载完成 · 可以开始检测");
  } else {
    setStatus("模型已就绪 · 请选择本地视频，加载完成后再开始检测");
  }
  syncStartEnabled();
}

function setApiStatus(ok: boolean, detail?: string): void {
  apiOk = ok;
  apiStatusEl.textContent = ok
    ? `Python API: 已连接${detail ? ` · ${detail}` : ""}`
    : `Python API: 未连接${detail ? ` · ${detail}` : ""}`;
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
    setApiStatus(true);
    return true;
  } catch {
    setApiStatus(false, "请先启动 python/server.py");
    return false;
  }
}

function applyLockFromSort(sorted: SortResponse): void {
  numberingSlots = slotsFromSort(sorted.people);
  // Freeze identity to seat index — ignore MediaPipe trackId after this point.
  seatAnchors = createSeatAnchors(numberingSlots, { minFrames: RAISE_MIN_FRAMES });
  numberingSlots = seatsToNumberingSlots(seatAnchors);
  lockedPeople = sorted.people.map((p) => ({ ...p, raised: false }));
  seatRaiseByIndex = new Map(
    seatAnchors.map((s) => [
      s.index,
      new SeatRaiseTracker({
        minFrames: RAISE_MIN_FRAMES,
        scoreThreshold: RAISE_SCORE_THRESHOLD,
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

async function lockNumberingFromQwen(numbered: NumberedFace[]): Promise<void> {
  if (sortInFlight || countLock.locked) return;
  if (numbered.length === 0) return;
  sortInFlight = true;
  try {
    countLock = {
      locked: true,
      streak: 1,
      lastCount: numbered.length,
    };
    applyLockFromSort({
      count: numbered.length,
      people: numbered.map((f) => ({
        index: f.index,
        x: f.cx,
        y: f.cy,
        id: f.index,
      })),
    });
    commitLockedFaces(numbered);
    const faceBound = bindFaceTemplatesToSeats();
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
    setApiStatus(true, "千问编号已锁定");
    setStatus(
      `千问已锁定 ${numbered.length} 人（左→右）· 人脸 ${faceBound}/${numbered.length} · 单人放大 Pose 检测举手`,
    );
  } finally {
    sortInFlight = false;
  }
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
    : lastNumberedFaces.map((f) => ({
        index: f.index,
        x: f.cx,
        y: f.cy,
        raised: false,
      }));

  for (const p of display) {
    const li = document.createElement("li");
    const isWinner = winner?.personIndex === p.index;
    if (isWinner) {
      li.textContent = `${p.index} 最先`;
    } else if (p.raised) {
      li.textContent = `${p.index} 举手`;
    } else {
      li.textContent = String(p.index);
    }
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

function drawNumberedFaces(w: number, h: number): void {
  const faces = lastNumberedFaces;
  for (const f of faces) {
    ctx.strokeStyle = "rgba(61, 156, 253, 0.85)";
    ctx.lineWidth = 2;
    ctx.strokeRect(f.xMin * w, f.yMin * h, f.width * w, f.height * h);
    const label = f.index != null ? `#${f.index}` : "脸";
    ctx.fillStyle = "rgba(61, 156, 253, 0.95)";
    ctx.font = "bold 16px Segoe UI, sans-serif";
    ctx.fillText(label, f.xMin * w + 4, Math.max(16, f.yMin * h - 6));
  }
}

function drawOverlay(
  tracked: TrackedPose[],
  people: SortedPerson[],
  winner: FirstRaiseEvent | null,
  locked: boolean,
): void {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  drawPersonCrops(lastPersonCrops, w, h);
  drawNumberedFaces(w, h);

  if (locked) {
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
      let text: string;
      if (isWinner) text = `#${index} 最先`;
      else if (raised) text = `#${index} 举手`;
      else text = `#${index}`;
      const face = lastNumberedFaces.find((f) => f.index === index);
      const lx = face?.cx ?? seat.x;
      const ly = face?.cy ?? seat.y;
      ctx.fillText(text, lx * w - 14, ly * h - 16);
    }
    void people;
    void tracked;
    return;
  }

  for (const t of tracked) {
    const raised = t.debouncer.raised;
    const ls = t.landmarks[POSE.LEFT_SHOULDER];
    const rs = t.landmarks[POSE.RIGHT_SHOULDER];
    if (ls && rs) {
      ctx.strokeStyle = raised ? "#2dd4a8" : "#8b98a5";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ls.x * w, ls.y * h);
      ctx.lineTo(rs.x * w, rs.y * h);
      ctx.stroke();
    }
    ctx.fillStyle = raised ? "#2dd4a8" : "#e7ecf1";
    ctx.font = "bold 28px Segoe UI, sans-serif";
    ctx.fillText("…", t.center.x * w - 14, t.center.y * h - 16);
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
  lastFaceByTrack = new Map();
  lastFaceBoxes = [];
  lastNumberedFaces = [];
  lastPersonCrops = [];
  faceBySeatIndex = new Map();
  lastFaceTs = 0;
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
    renderHud(lastNumberedFaces.length, [], null, false);
    drawOverlay([], [], null, false);
    if (numberingPhase) {
      setStatus(`千问编号中 · 需要 ${readExpectedCount()} 人 · 编号锁定前不检测举手`);
    }
    return;
  }

  const expected = readExpectedCount();
  pollQwenNumbering(nowMs, expected);
  const cascade = runQwenMpCascade({
    landmarker,
    frameCanvas,
    cropCanvas,
    source: video,
    faces: lastFaceBoxes,
    seats: countLock.locked && seatAnchors.length > 0 ? seatAnchors : undefined,
    faceByIndex: faceBySeatIndex,
  });
  lastPersonCrops = cascade.boxes;
  const poses = cascade.poses;

  updateTimeUi();

  // Raise detection only after numbering is locked.
  // Identity stays on the locked face index — pose must not move the number.
  const indexedPoses = indexedPosesFromCascade(poses);
  seatAnchors = bindPosesToSeatsByIndex(seatAnchors, indexedPoses, {
    maxMissed: TRACK_MAX_MISSED,
  });
  if (lastNumberedFaces.length > 0) {
    commitLockedFaces(nudgeLockedFacesTowardHeads(lastNumberedFaces, indexedPoses));
  }

    numberingSlots = seatsToNumberingSlots(seatAnchors);
    updateSeatRaises(seatAnchors, nowMs);

    const people = peopleFromSeats(seatAnchors);
    const liveSeats = people.filter((p) =>
      seatAnchors.find((s) => s.index === p.index)?.landmarks,
    ).length;
    const faceBound = countSlotsWithFace(numberingSlots);

    // Race uses raw raise + interpolated edge time (not seat index on ties).
    race.update(
      seatAnchors.map((s) => {
        const u = lastRaiseByIndex.get(s.index);
        return {
          personIndex: s.index,
          raised: !!u?.rawRaised,
          score: u?.score ?? 0,
          edgeAtMs: u?.edgeAtMs,
        };
      }),
      nowMs,
    );
    const winner = race.winner;

    renderHud(liveSeats, people, winner, true);
    drawOverlay([], people, winner, true);

    const raisedIndexes = people
      .filter((p) => p.raised)
      .map((p) => ({
        index: p.index,
        t: lastRaiseByIndex.get(p.index)?.edgeAtMs ?? Number.POSITIVE_INFINITY,
      }))
      .sort((a, b) => a.t - b.t || a.index - b.index)
      .map((p) => p.index);
    const missed = seatAnchors.filter((s) => !s.fresh).length;
    if (winner) {
      setStatus(`最先举手：#${winner.personIndex} · 「下一轮」再赛 · 「重新编号」可重排`);
    } else if (missed > 0) {
      setStatus(
        `座位锁定 ${people.length} · 在场 ${liveSeats} · 人脸 ${faceBound} · ${missed} 座短暂丢失（编号不变）`,
      );
    } else if (raisedIndexes.length === 0) {
      setStatus(
        `座位锁定 ${people.length} 人 · 千问编号 · 单人放大 Pose · 等待举手…`,
      );
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

function revokeObjectUrl(): void {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

function onFileSelected(): void {
  const file = inputVideo.files?.[0];
  if (!file) return;
  stopDetection({ keepFile: false, keepModels: true });
  revokeObjectUrl();
  videoReady = false;
  objectUrl = URL.createObjectURL(file);
  video.srcObject = null;
  video.src = objectUrl;
  video.load();
  fileNameEl.textContent = file.name;
  seekEl.disabled = true;
  btnStart.disabled = true;
  showLoadOverlay("正在加载视频…", file.name);
  setStatus(`正在加载「${file.name}」· 完成后才能开始检测`);
}

async function preloadModels(): Promise<void> {
  if (modelsReady) return;
  if (modelsPromise) return modelsPromise;
  modelsPromise = (async () => {
    try {
      showLoadOverlay("正在加载检测模型…", "1/2 检查千问人脸编号");
      setStatus("正在连接千问编号并加载 Pose，完成后才能开始检测");
      syncStartEnabled();
      const healthy = await checkHealth();
      try {
        const faceSt = await fetchQwenFaceStatus();
        qwenFaceOk = !!faceSt.configured;
        if (qwenFaceOk) {
          setApiStatus(true, `千问编号 · ${faceSt.model ?? "qwen-vl"}`);
        } else {
          setApiStatus(healthy, "千问未配置 · 请在 python/data/api.env 填写 LLM_API_KEY");
        }
      } catch {
        qwenFaceOk = false;
        setApiStatus(healthy, "无法读取千问状态 · 请先启动 python/server.py");
      }

      if (!qwenFaceOk) {
        modelsReady = false;
        modelsPromise = null;
        showLoadOverlay(
          "千问未就绪",
          "检测只走千问：请启动 Python API，并在 python/data/api.env 填写 LLM_API_KEY",
          true,
        );
        setStatus("千问未就绪 · 未配置或 API 未启动，无法开始检测");
        syncStartEnabled();
        return;
      }

      showLoadOverlay("正在加载检测模型…", "2/2 MediaPipe Pose（按编号局部放大）");
      landmarker = await createPoseLandmarker({
        numPoses: 1,
        runningMode: "IMAGE",
        modelAssetPath: FULL_MODEL_URL,
        minPoseDetectionConfidence: 0.35,
        minPosePresenceConfidence: 0.35,
        minTrackingConfidence: 0.35,
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
      setStatus(`模型加载失败：${msg} · 请刷新页面重试`);
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
  if (!modelsReady || !landmarker || !qwenFaceOk) {
    setStatus("千问或 Pose 尚未就绪，请稍候");
    await preloadModels();
    if (!modelsReady || !landmarker || !qwenFaceOk) return;
  }
  if (!videoReady || video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
    setStatus("视频尚未加载完成，请稍候");
    showLoadOverlay("正在加载视频…", fileNameEl.textContent || "请稍候");
    return;
  }
  btnStart.disabled = true;
  try {
    tracker = new PoseTracker({
      matchDistance: TRACK_MATCH_DISTANCE,
      matchYWeight: TRACK_MATCH_Y_WEIGHT,
      maxMissed: TRACK_MAX_MISSED,
      minFrames: RAISE_MIN_FRAMES,
    });
    clearNumberingLock();
    lastTs = 0;
    lastFaceTs = 0;
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
    qwenFaceOk = false;
  }
  tracker.reset();
  clearNumberingLock();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  renderHud(0, [], null, false);
  btnStop.disabled = true;
  btnPause.disabled = true;
  btnReset.disabled = true;
  btnRelock.disabled = true;
  btnPause.textContent = "暂停视频";
  if (!opts?.keepFile) {
    videoReady = false;
  }
  syncStartEnabled();
  if (modelsReady && hasVideoFile() && videoReady) {
    hideLoadOverlay();
    setStatus("已停止检测 · 加载已完成，可再次「开始检测」");
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
    tracker.reset();
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
  tracker.reset();
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
  setStatus("视频播放结束 · 可拖动进度条重播或停止检测");
});

window.addEventListener("beforeunload", () => {
  revokeObjectUrl();
});

void checkHealth();
window.setInterval(() => {
  if (!apiOk) void checkHealth();
}, 2000);
void preloadModels();
