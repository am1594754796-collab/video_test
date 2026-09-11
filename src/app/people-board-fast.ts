/**
 * People board (fast path):
 * 1) Wait until on-screen count matches expected (stable) → one Python L→R sort → lock indices to trackIds
 * 2) At lock: bind each seat to a session face template
 * 3) After lock: rebind by face (preferred) then position; hand-raise + first-raise only
 */

import { PoseLandmarker } from "@mediapipe/tasks-vision";
import {
  assignFaceDescriptorsToTracks,
  countSlotsWithFace,
  createCountLockState,
  createPoseLandmarker,
  FirstRaiseTracker,
  FULL_MODEL_URL,
  indexByTrackIdFromSlots,
  isHandRaised,
  numberFacesLeftToRight,
  observePersonCount,
  PoseTracker,
  rebindSlotsToTracks,
  runQwenMpCascade,
  shouldPollVisionFaces,
  slotsFromSort,
  startCamera,
  unlockCountLock,
  type CameraHandle,
  type CountLockSnapshot,
  type FaceBox,
  type FaceDescriptor,
  type FirstRaiseEvent,
  type NumberedFace,
  type NumberingSlot,
  type PersonBox,
  type TrackedPose,
} from "../vision";
import { POSE } from "../vision/detect/isHandRaised";
import { publishClassroomEvent } from "./classroomBus";
import { detectFacesViaQwen, fetchQwenFaceStatus } from "./qwenFaceDetect";

const DETECT_INTERVAL_MS = 50;
/** Qwen-VL: lock capture once; afterwards only if a seat is missing, at most every 1s. */
const FACE_DETECT_INTERVAL_MS = 1000;
/** Consecutive Qwen snapshots at expected count before lock. */
const LOCK_STABLE_FRAMES = 1;
/** How far (normalized) a returning person can be from their locked seat to reclaim the number. */
const REBIND_MAX_DISTANCE = 0.35;
const MIN_FACE_SIMILARITY = 0.82;
/** Prefer horizontal seat lock; avoid stealing a neighbor track. */
const TRACK_MATCH_DISTANCE = 0.12;
const TRACK_MATCH_Y_WEIGHT = 0.35;
const TRACK_MAX_MISSED = 8; // drop ghosts faster in crowded scenes

const frameCanvas = document.createElement("canvas");
const cropCanvas = document.createElement("canvas");

type PersonPoint = { id: number; x: number; y: number };

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
const btnStart = document.querySelector<HTMLButtonElement>("#btn-start")!;
const btnStop = document.querySelector<HTMLButtonElement>("#btn-stop")!;
const btnReset = document.querySelector<HTMLButtonElement>("#btn-reset")!;
const btnRelock = document.querySelector<HTMLButtonElement>("#btn-relock")!;
const inputExpected = document.querySelector<HTMLInputElement>("#input-expected")!;

const HEALTH_URL = "/api/health";

let camera: CameraHandle | null = null;
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
let canvasSized = false;
let apiOk = false;
let tracker = new PoseTracker({
  matchDistance: TRACK_MATCH_DISTANCE,
  matchYWeight: TRACK_MATCH_Y_WEIGHT,
  maxMissed: TRACK_MAX_MISSED,
  minFrames: 8,
});
let race = new FirstRaiseTracker();
let countLock: CountLockSnapshot = createCountLockState();
/** Sticky seats after lock: index ↔ trackId + face + last known center. */
let numberingSlots: NumberingSlot[] = [];
let indexByTrackId = new Map<number, number>();
let lockedPeople: SortedPerson[] = [];
let sortInFlight = false;
let detectInFlight = false;
let lastUiKey = "";
let lastWinnerKey = "";

function headAnchor(t: TrackedPose): { x: number; y: number } {
  const nose = t.landmarks[POSE.NOSE];
  if (nose && (nose.visibility ?? 1) >= 0.35) {
    return { x: nose.x, y: nose.y };
  }
  return { x: t.center.x, y: Math.max(0, t.center.y - 0.12) };
}

function pollQwenFaces(nowMs: number, expected: number, tracked: TrackedPose[] = []): void {
  if (!qwenFaceOk) return;
  if (
    !shouldPollVisionFaces({
      nowMs,
      lastFaceTs,
      minIntervalMs: FACE_DETECT_INTERVAL_MS,
      inFlight: faceInFlight,
    })
  ) {
    return;
  }
  faceInFlight = true;
  lastFaceTs = nowMs;
  void detectFacesViaQwen(video, { maxFaces: expected })
    .then((faces) => {
      lastFaceBoxes = faces;
      lastNumberedFaces = numberFacesLeftToRight(faces, expected);
      if (tracked.length) {
        lastFaceByTrack = assignFaceDescriptorsToTracks(
          video,
          tracked.map((t) => {
            const h = headAnchor(t);
            return { trackId: t.trackId, x: h.x, y: h.y };
          }),
          faces,
        );
      }
    })
    .catch((err) => {
      console.warn("[face/qwen]", err);
    })
    .finally(() => {
      faceInFlight = false;
    });
}

async function captureFaceTemplates(tracked: TrackedPose[]): Promise<number> {
  if (!qwenFaceOk) return 0;
  try {
    lastFaceBoxes = await detectFacesViaQwen(video);
    lastFaceByTrack = assignFaceDescriptorsToTracks(
      video,
      tracked.map((t) => {
        const h = headAnchor(t);
        return { trackId: t.trackId, x: h.x, y: h.y };
      }),
      lastFaceBoxes,
    );
    lastFaceTs = performance.now();
  } catch (err) {
    console.warn("[face/qwen] lock capture failed", err);
    return countSlotsWithFace(numberingSlots);
  }
  for (const slot of numberingSlots) {
    if (slot.trackId == null) continue;
    const desc = lastFaceByTrack.get(slot.trackId);
    if (desc) slot.faceDescriptor = desc;
  }
  return countSlotsWithFace(numberingSlots);
}

function readExpectedCount(): number {
  const n = Number(inputExpected.value);
  if (!Number.isFinite(n)) return 2;
  return Math.min(6, Math.max(1, Math.round(n)));
}

function setStatus(text: string): void {
  statusEl.textContent = text;
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

function sortLocal(people: PersonPoint[]): SortResponse {
  const sorted = [...people].sort((a, b) => a.x - b.x).slice(0, 6);
  return {
    count: sorted.length,
    people: sorted.map((p, i) => ({
      index: i + 1,
      x: p.x,
      y: p.y,
      id: p.id,
    })),
  };
}

function applyLockFromSort(sorted: SortResponse): void {
  numberingSlots = slotsFromSort(sorted.people);
  indexByTrackId = indexByTrackIdFromSlots(numberingSlots);
  lockedPeople = sorted.people.map((p) => ({ ...p, raised: false }));
}

function syncSlotsWithTracks(tracked: TrackedPose[]): void {
  numberingSlots = rebindSlotsToTracks(
    numberingSlots,
    tracked.map((t) => ({
      trackId: t.trackId,
      x: t.center.x,
      y: t.center.y,
      faceDescriptor: lastFaceByTrack.get(t.trackId) ?? null,
    })),
    { maxDistance: REBIND_MAX_DISTANCE, minFaceSimilarity: MIN_FACE_SIMILARITY },
  );
  indexByTrackId = indexByTrackIdFromSlots(numberingSlots);
  lockedPeople = numberingSlots.map((s) => ({
    index: s.index,
    x: s.x,
    y: s.y,
    id: s.trackId,
    raised: false,
  }));
}

async function lockNumbering(payload: PersonPoint[], tracked: TrackedPose[]): Promise<void> {
  if (sortInFlight) return;
  sortInFlight = true;
  try {
    const sorted = sortLocal(payload);
    applyLockFromSort(sorted);
    const faceBound = await captureFaceTemplates(tracked);
    race = new FirstRaiseTracker();
    race.update(
      sorted.people.map((p) => ({ personIndex: p.index, raised: false })),
      performance.now(),
    );
    lastUiKey = "";
    lastWinnerKey = "";
    publishClassroomEvent({
      type: "numbering-locked",
      seats: sorted.people.map((p) => p.index),
      source: "people-fast",
    });
    setApiStatus(true, "千问左→右编号已锁定");
    setStatus(
      `已锁定 ${sorted.count} 人（左→右）· 千问人脸 ${faceBound}/${sorted.count} · 开始举手检测`,
    );
  } finally {
    sortInFlight = false;
  }
}

function peopleFromLockedTracks(tracked: TrackedPose[]): SortedPerson[] {
  const out: SortedPerson[] = [];
  for (const t of tracked) {
    const index = indexByTrackId.get(t.trackId);
    if (index == null) continue;
    out.push({
      index,
      x: t.center.x,
      y: t.center.y,
      id: t.trackId,
      raised: t.debouncer.raised,
    });
  }
  out.sort((a, b) => a.index - b.index);
  return out;
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
      source: "people-fast",
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

function drawOverlay(
  tracked: TrackedPose[],
  people: SortedPerson[],
  winner: FirstRaiseEvent | null,
  locked: boolean,
): void {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (lastPersonCrops.length) {
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(240, 180, 41, 0.8)";
    ctx.font = "12px Segoe UI, sans-serif";
    ctx.fillStyle = "rgba(240, 180, 41, 0.95)";
    for (const b of lastPersonCrops) {
      ctx.strokeRect(b.xMin * w, b.yMin * h, (b.xMax - b.xMin) * w, (b.yMax - b.yMin) * h);
      ctx.fillText("放大", b.xMin * w + 4, Math.max(14, b.yMin * h - 4));
    }
    ctx.restore();
  }

  const faces = lastNumberedFaces.length ? lastNumberedFaces : lastFaceBoxes;
  for (const f of faces) {
    ctx.strokeStyle = "rgba(61, 156, 253, 0.85)";
    ctx.lineWidth = 2;
    ctx.strokeRect(f.xMin * w, f.yMin * h, f.width * w, f.height * h);
    if (f.index != null) {
      ctx.fillStyle = "rgba(61, 156, 253, 0.95)";
      ctx.font = "bold 16px Segoe UI, sans-serif";
      ctx.fillText(`#${f.index}`, f.xMin * w + 4, Math.max(16, f.yMin * h - 6));
    }
  }

  if (locked) {
    for (const slot of numberingSlots) {
      if (slot.trackId != null) continue;
      ctx.fillStyle = "rgba(139, 152, 165, 0.85)";
      ctx.font = "bold 24px Segoe UI, sans-serif";
      ctx.fillText(`#${slot.index}?`, slot.x * w - 18, slot.y * h - 16);
    }
  }

  for (const t of tracked) {
    const index = locked ? indexByTrackId.get(t.trackId) : undefined;
    if (locked && index == null) continue; // stranger / not yet rebound — don't flash "?"
    const label = index ?? "?";
    const isWinner = winner != null && index === winner.personIndex;
    const raised = t.debouncer.raised;
    const ls = t.landmarks[POSE.LEFT_SHOULDER];
    const rs = t.landmarks[POSE.RIGHT_SHOULDER];
    if (ls && rs) {
      ctx.strokeStyle = isWinner ? "#f0b429" : raised ? "#2dd4a8" : locked ? "#3d9cfd" : "#8b98a5";
      ctx.lineWidth = isWinner ? 5 : 3;
      ctx.beginPath();
      ctx.moveTo(ls.x * w, ls.y * h);
      ctx.lineTo(rs.x * w, rs.y * h);
      ctx.stroke();
    }
    ctx.fillStyle = isWinner ? "#f0b429" : raised ? "#2dd4a8" : "#e7ecf1";
    ctx.font = "bold 28px Segoe UI, sans-serif";
    let text: string;
    if (!locked) text = "…";
    else if (isWinner) text = `#${label} 最先`;
    else if (raised) text = `#${label} 举手`;
    else text = `#${label}`;
    ctx.fillText(text, t.center.x * w - 14, t.center.y * h - 16);
  }

  void people;
}

function clearNumberingLock(): void {
  countLock = unlockCountLock(countLock);
  numberingSlots = [];
  indexByTrackId = new Map();
  lockedPeople = [];
  lastFaceByTrack = new Map();
  lastFaceBoxes = [];
  lastNumberedFaces = [];
  lastPersonCrops = [];
  race = new FirstRaiseTracker();
  lastUiKey = "";
  renderWinner(null);
  publishClassroomEvent({ type: "numbering-cleared", source: "people-fast" });
}

async function loop(nowMs: number): Promise<void> {
  raf = requestAnimationFrame((t) => void loop(t));
  if (!landmarker || video.readyState < 2) return;
  if (!ensureCanvasSize()) return;
  if (nowMs - lastTs < DETECT_INTERVAL_MS) return;
  lastTs = nowMs;
  if (detectInFlight) return;
  detectInFlight = true;
  try {

  const expected = readExpectedCount();
  const cascade = runQwenMpCascade({
    landmarker,
    frameCanvas,
    cropCanvas,
    source: video,
    faces: lastFaceBoxes,
  });
  lastPersonCrops = cascade.boxes;
  const poses = cascade.poses;
  const trackedAll = tracker.update(poses);
  const fresh = trackedAll.filter((t) => t.fresh);
  const tracked = countLock.locked
    ? trackedAll
    : (fresh.length >= expected ? fresh : trackedAll).slice(0, expected);

  pollQwenFaces(nowMs, expected, tracked);
  if (countLock.locked) {
    syncSlotsWithTracks(tracked);
  }

  for (const t of tracked) {
    if (!countLock.locked) continue;
    if (!indexByTrackId.has(t.trackId)) continue;
    t.debouncer.update(
      isHandRaised(t.landmarks, {
        margin: 0.02,
        minVisibility: 0.32,
        maxWristFromShoulder: 0.58,
        maxUpperArm: 0.48,
        maxForearm: 0.48,
        minElbowDeg: 20,
        maxElbowDeg: 170,
        otherLandmarks: tracked.filter((o) => o.trackId !== t.trackId).map((o) => o.landmarks),
      }),
    );
  }

  const payload = lastNumberedFaces.map((f) => ({
    id: f.index,
    x: f.cx,
    y: f.cy,
  }));
  const liveCount = payload.length;

  if (!countLock.locked) {
    const observed = observePersonCount(countLock, liveCount, {
      expectedCount: expected,
      minStableFrames: LOCK_STABLE_FRAMES,
    });
    countLock = observed.state;
    renderHud(liveCount, [], null, false);
    drawOverlay(tracked, [], null, false);

    if (observed.shouldLock) {
      setStatus(`千问已编号 ${expected} 人 · 正在锁定…`);
      await lockNumbering(payload, tracked);
    } else if (liveCount === expected) {
      setStatus(`千问已编号 ${liveCount}/${expected} · 单人放大 Pose ${poses.length} · 正在锁定…`);
    } else if (faceInFlight && liveCount === 0) {
      setStatus(`千问正在识别人脸并编号（需要 ${expected} 人）…`);
    } else {
      setStatus(
        `千问编号 ${liveCount}/${expected} · 单人放大 Pose ${poses.length}${
          faceInFlight ? " · 识别中" : ""
        }`,
      );
    }
    return;
  }

  // Locked: hand-raise + first-raise only (no Python sort).
  const people = peopleFromLockedTracks(tracked);
  const missing = numberingSlots.filter((s) => s.trackId == null).length;
  const faceBound = countSlotsWithFace(numberingSlots);
  race.update(
    people.map((p) => ({ personIndex: p.index, raised: !!p.raised })),
    nowMs,
  );
  const winner = race.winner;

  renderHud(liveCount, people, winner, true);
  drawOverlay(tracked, people, winner, true);

  const raisedIndexes = people.filter((p) => p.raised).map((p) => p.index);
  if (winner) {
    setStatus(`最先举手：#${winner.personIndex} · 「下一轮」再赛 · 「重新编号」可重排`);
  } else if (missing > 0) {
    setStatus(
      `编号已锁定 · 在场 ${people.length}/${lockedPeople.length} · 人脸绑座 ${faceBound} · 丢失者按人脸/位置找回`,
    );
  } else if (raisedIndexes.length === 0) {
    setStatus(`编号已锁定 ${lockedPeople.length} 人 · 人脸绑座 ${faceBound} · 等待举手…`);
  } else {
    setStatus(`举手中：${raisedIndexes.map((n) => `#${n}`).join("、")}`);
  }
  } finally {
    detectInFlight = false;
  }
}

async function onStart(): Promise<void> {
  btnStart.disabled = true;
  setStatus("连接千问并加载 Pose…");
  try {
    await checkHealth();
    try {
      const faceSt = await fetchQwenFaceStatus();
      qwenFaceOk = !!faceSt.configured;
      if (qwenFaceOk) {
        setApiStatus(true, `千问编号 · ${faceSt.model ?? "qwen-vl"}`);
      } else {
        setApiStatus(apiOk, "千问未配置 · 请在 python/data/api.env 填写 LLM_API_KEY");
      }
    } catch {
      qwenFaceOk = false;
      setApiStatus(apiOk, "无法读取千问状态 · 请先启动 python/server.py");
    }
    if (!qwenFaceOk) {
      throw new Error("千问未就绪：请启动 Python API 并填写 LLM_API_KEY");
    }
    landmarker = await createPoseLandmarker({
      numPoses: 1,
      runningMode: "IMAGE",
      modelAssetPath: FULL_MODEL_URL,
      minPoseDetectionConfidence: 0.35,
      minPosePresenceConfidence: 0.35,
      minTrackingConfidence: 0.35,
    });
    camera = await startCamera(video);
    tracker = new PoseTracker({
      matchDistance: TRACK_MATCH_DISTANCE,
      matchYWeight: TRACK_MATCH_Y_WEIGHT,
      maxMissed: TRACK_MAX_MISSED,
      minFrames: 8,
    });
    clearNumberingLock();
    lastTs = 0;
    lastFaceTs = 0;
    canvasSized = false;
    btnStop.disabled = false;
    btnReset.disabled = false;
    btnRelock.disabled = false;
    setStatus(`运行中 · 千问人脸编号 · 单人放大 Pose · 等待 ${readExpectedCount()} 人`);
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame((t) => void loop(t));
  } catch (err) {
    console.error(err);
    setStatus(err instanceof Error ? err.message : "启动失败");
    btnStart.disabled = false;
    landmarker?.close();
    landmarker = null;
  }
}

function onStop(): void {
  cancelAnimationFrame(raf);
  camera?.stop();
  camera = null;
  landmarker?.close();
  landmarker = null;
  qwenFaceOk = false;
  tracker.reset();
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
  race.reset();
  lastUiKey = "";
  renderWinner(null);
  publishClassroomEvent({ type: "race-reset", source: "people-fast" });
  setStatus("已重置本轮 · 编号保持 · 等待最先举手");
}

function onRelock(): void {
  clearNumberingLock();
  setStatus(`已解除编号 · 等待千问重新识别 ${readExpectedCount()} 人`);
}

btnStart.addEventListener("click", () => void onStart());
btnStop.addEventListener("click", onStop);
btnReset.addEventListener("click", onResetRound);
btnRelock.addEventListener("click", onRelock);
void checkHealth();
window.setInterval(() => {
  if (!apiOk) void checkHealth();
}, 2000);
