/**
 * People board (camera): same pipeline as video —
 * MediaPipe multi-person self-split L→R lock → isolate zoom Pose → strict raise.
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
  observePersonCount,
  personBoxesFromPoses,
  personBoxesFromSeats,
  runMpOnPersonBoxes,
  SeatRaiseTracker,
  seatsToNumberingSlots,
  slotsFromSort,
  startCamera,
  torsoCenter,
  unlockCountLock,
  type CameraHandle,
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
/** Consecutive frames at expected count before lock. */
const LOCK_STABLE_FRAMES = 3;
/** Strict MediaPipe joint raise — first frame that passes counts. */
const RAISE_MARGIN = 0.025;
const RAISE_MIN_VISIBILITY = 0.25;
const RAISE_MIN_FRAMES = 1;
const RAISE_SCORE_THRESHOLD = 0.015;
const TRACK_MAX_MISSED = 10;
const BUS_SOURCE = "people-fast";

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
const btnStart = document.querySelector<HTMLButtonElement>("#btn-start")!;
const btnStop = document.querySelector<HTMLButtonElement>("#btn-stop")!;
const btnReset = document.querySelector<HTMLButtonElement>("#btn-reset")!;
const btnRelock = document.querySelector<HTMLButtonElement>("#btn-relock")!;
const inputExpected = document.querySelector<HTMLInputElement>("#input-expected")!;

const HEALTH_URL = "/api/health";

let camera: CameraHandle | null = null;
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
let lockInFlight = false;
let lastUiKey = "";
let lastWinnerKey = "";

function readExpectedCount(): number {
  const n = Number(inputExpected.value);
  if (!Number.isFinite(n)) return 2;
  return Math.min(6, Math.max(1, Math.round(n)));
}

function setStatus(text: string): void {
  statusEl.textContent = text;
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

function lockNumbering(
  numbered: { index: number; x: number; y: number; landmarks: readonly PoseLandmark[] }[],
): void {
  // observePersonCount may already flip locked=true; still need seat anchors.
  if (seatAnchors.length > 0) return;
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
  preview?: SortedPerson[],
): void {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  drawPersonCrops(lastPersonCrops, w, h);

  if (!locked) {
    for (const p of preview ?? []) {
      ctx.fillStyle = "rgba(231, 236, 241, 0.9)";
      ctx.font = "bold 24px Segoe UI, sans-serif";
      ctx.fillText(`#${p.index}?`, p.x * w - 14, p.y * h - 16);
    }
    return;
  }

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
  lockInFlight = false;
  renderWinner(null);
  publishClassroomEvent({ type: "numbering-cleared", source: BUS_SOURCE });
}

async function loop(nowMs: number): Promise<void> {
  raf = requestAnimationFrame((t) => void loop(t));
  if (!landmarker || video.readyState < 2) return;
  if (!ensureCanvasSize()) return;
  const interval = countLock.locked ? DETECT_INTERVAL_LOCKED_MS : DETECT_INTERVAL_MS;
  if (nowMs - lastTs < interval) return;
  lastTs = nowMs;
  if (detectInFlight) return;
  detectInFlight = true;
  try {
    const expected = readExpectedCount();

    if (!countLock.locked) {
      const scout = scoutPoses();
      const numbered = numberPosesLeftToRight(scout, expected);
      const liveCount = numbered.length;
      const preview = numbered.map((p) => ({
        index: p.index,
        x: p.x,
        y: p.y,
        id: p.index,
      }));

      // Preview crops so close neighbors are visible while waiting to lock.
      if (numbered.length > 0) {
        lastPersonCrops = personBoxesFromPoses(numbered);
      } else {
        lastPersonCrops = [];
      }

      const observed = observePersonCount(countLock, liveCount, {
        expectedCount: expected,
        minStableFrames: LOCK_STABLE_FRAMES,
      });
      countLock = observed.state;
      renderHud(liveCount, [], null, false);
      drawOverlay([], null, false, preview);

      if (observed.shouldLock && !lockInFlight && numbered.length >= expected) {
        lockInFlight = true;
        setStatus(`已检出 ${expected} 人 · 近距切开并锁定…`);
        const take = numbered.slice(0, expected);
        const boxes = personBoxesFromPoses(take);
        const cascade = runMpOnPersonBoxes({
          landmarker,
          frameCanvas,
          cropCanvas,
          source: video,
          boxes,
        });
        lastPersonCrops = cascade.boxes;
        const refined = indexedPosesFromCascade(cascade.poses);
        const byIndex = new Map(refined.map((p) => [p.index, p]));
        const locked = take.map((p) => byIndex.get(p.index) ?? p);
        lockNumbering(locked);
        lockInFlight = false;
      } else if (liveCount === expected) {
        setStatus(
          `本地编号 ${liveCount}/${expected} · 稳定 ${countLock.streak}/${LOCK_STABLE_FRAMES} · 近距自动切开`,
        );
      } else {
        setStatus(`本地分割编号 ${liveCount}/${expected} · 需要 ${expected} 人后锁定 · 锁定前不检测举手`);
      }
      return;
    }

    // Locked: isolate close seats, zoom crop, single-person Pose, strict raise.
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

async function onStart(): Promise<void> {
  btnStart.disabled = true;
  setStatus("加载 MediaPipe Pose（多人 + 局部放大）…");
  try {
    await checkHealth();
    landmarker = await createPoseLandmarker({
      numPoses: 6,
      runningMode: "IMAGE",
      modelAssetPath: FULL_MODEL_URL,
      minPoseDetectionConfidence: 0.4,
      minPosePresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
    });
    camera = await startCamera(video);
    clearNumberingLock();
    lastTs = 0;
    canvasSized = false;
    btnStop.disabled = false;
    btnReset.disabled = false;
    btnRelock.disabled = false;
    setStatus(`运行中 · 本地分割编号 · 等待 ${readExpectedCount()} 人稳定后锁定`);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame((t) => void loop(t));
  } catch (err) {
    console.error(err);
    setStatus(err instanceof Error ? err.message : "启动失败");
    btnStart.disabled = false;
    landmarker?.close();
    landmarker = null;
    camera?.stop();
    camera = null;
  }
}

function onStop(): void {
  cancelAnimationFrame(raf);
  camera?.stop();
  camera = null;
  landmarker?.close();
  landmarker = null;
  clearNumberingLock();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  renderHud(0, [], null, false);
  btnStart.disabled = false;
  btnStop.disabled = true;
  btnReset.disabled = true;
  btnRelock.disabled = true;
  setStatus("已停止");
}

function onResetRound(): void {
  if (!countLock.locked) return;
  race.reset();
  lastUiKey = "";
  renderWinner(null);
  publishClassroomEvent({ type: "race-reset", source: BUS_SOURCE });
  setStatus("已重置本轮 · 编号保持 · 等待最先举手");
}

function onRelock(): void {
  clearNumberingLock();
  setStatus(`已解除编号 · 等待本地重新检出 ${readExpectedCount()} 人`);
}

btnStart.addEventListener("click", () => void onStart());
btnStop.addEventListener("click", onStop);
btnReset.addEventListener("click", onResetRound);
btnRelock.addEventListener("click", onRelock);
void checkHealth();
