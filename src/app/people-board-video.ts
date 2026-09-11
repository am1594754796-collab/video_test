/**
 * People board (video file path):
 * Same lock / face-seat / raise logic as people-fast, but source is a local video file.
 */

import { PoseLandmarker } from "@mediapipe/tasks-vision";
import {
  assignFaceDescriptorsToTracks,
  countSlotsWithFace,
  createCountLockState,
  createPoseLandmarker,
  collapseByMinGapX,
  createSeatAnchors,
  dedupeRowPoses,
  detectPosesMultiBand,
  emaBlendLandmarks,
  FirstRaiseTracker,
  FULL_MODEL_URL,
  matchDetectionsToSeats,
  observePersonCount,
  PoseTracker,
  refineSeatsWithCrops,
  SeatRaiseTracker,
  seatsToNumberingSlots,
  selectPosesBySeatBins,
  shouldRefreshCloudFaces,
  slotsFromSort,
  torsoCenter,
  unlockCountLock,
  type CountLockSnapshot,
  type FaceBox,
  type FaceDescriptor,
  type FirstRaiseEvent,
  type NumberingSlot,
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
const FACE_DETECT_INTERVAL_MS = 1000;
const RAISE_MARGIN = 0.028;
const RAISE_MIN_VISIBILITY = 0.22;
const RAISE_MIN_FRAMES = 1;
const RAISE_SCORE_THRESHOLD = 0.014;
const LOCK_STABLE_FRAMES = 8;
/** Prefer horizontal seat lock; avoid stealing a neighbor track. */
const TRACK_MATCH_DISTANCE = 0.16;
const TRACK_MATCH_Y_WEIGHT = 0.35;
/** Drop unmatched ghosts, but keep a short grace for brief dropouts. */
const TRACK_MAX_MISSED = 10;
const LANDMARK_EMA_ALPHA = 0.4;
const BUS_SOURCE = "people-video";

const frameCanvas = document.createElement("canvas");
const bandCanvas = document.createElement("canvas");
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

const SORT_URL = "/api/people/sort";
const HEALTH_URL = "/api/health";

let objectUrl: string | null = null;
let detecting = false;
let landmarker: PoseLandmarker | null = null;
let qwenFaceOk = false;
let faceInFlight = false;
let raf = 0;
let lastTs = 0;
let lastFaceTs = 0;
let lastFaceByTrack = new Map<number, FaceDescriptor>();
let lastFaceBoxes: FaceBox[] = [];
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
let lastUiKey = "";
let lastWinnerKey = "";
let seeking = false;

function seatHeadAnchor(seat: SeatAnchor): { x: number; y: number } {
  const nose = seat.landmarks?.[POSE.NOSE];
  if (nose && (nose.visibility ?? 1) >= 0.35) {
    return { x: nose.x, y: nose.y };
  }
  return { x: seat.x, y: Math.max(0, seat.y - 0.12) };
}

function refreshFaceDescriptorsForSeats(nowMs: number, force = false): void {
  if (!qwenFaceOk || seatAnchors.length === 0) return;
  const missingSeat = seatAnchors.some((s) => !s.faceDescriptor);
  if (
    !shouldRefreshCloudFaces({
      force,
      missingSeat,
      nowMs,
      lastFaceTs,
      minIntervalMs: FACE_DETECT_INTERVAL_MS,
      inFlight: faceInFlight,
    })
  ) {
    if (!missingSeat) lastFaceBoxes = [];
    return;
  }
  faceInFlight = true;
  lastFaceTs = nowMs;
  void detectFacesViaQwen(video)
    .then((faces) => {
      lastFaceBoxes = faces;
      lastFaceByTrack = assignFaceDescriptorsToTracks(
        video,
        seatAnchors.map((s) => {
          const h = seatHeadAnchor(s);
          return { trackId: s.index, x: h.x, y: h.y };
        }),
        faces,
      );
      for (const seat of seatAnchors) {
        const desc = lastFaceByTrack.get(seat.index);
        if (desc) seat.faceDescriptor = desc;
      }
      numberingSlots = seatsToNumberingSlots(seatAnchors);
    })
    .catch((err) => {
      console.warn("[face/qwen]", err);
    })
    .finally(() => {
      faceInFlight = false;
    });
}

async function captureFaceTemplatesForSeats(): Promise<number> {
  if (!qwenFaceOk || seatAnchors.length === 0) return 0;
  try {
    lastFaceBoxes = await detectFacesViaQwen(video);
    lastFaceByTrack = assignFaceDescriptorsToTracks(
      video,
      seatAnchors.map((s) => {
        const h = seatHeadAnchor(s);
        return { trackId: s.index, x: h.x, y: h.y };
      }),
      lastFaceBoxes,
    );
    lastFaceTs = performance.now();
  } catch (err) {
    console.warn("[face/qwen] lock capture failed", err);
    return countSlotsWithFace(numberingSlots);
  }
  for (const seat of seatAnchors) {
    const desc = lastFaceByTrack.get(seat.index);
    if (desc) seat.faceDescriptor = desc;
  }
  numberingSlots = seatsToNumberingSlots(seatAnchors);
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

async function sortViaPython(people: PersonPoint[]): Promise<SortResponse> {
  const res = await fetch(SORT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ people, max_people: 6 }),
  });
  if (!res.ok) throw new Error(`sort HTTP ${res.status}`);
  return (await res.json()) as SortResponse;
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

function seedSeatsFromPoses(
  poses: readonly {
    x: number;
    y: number;
    landmarks: readonly PoseLandmark[];
  }[],
): void {
  if (seatAnchors.length === 0) return;
  seatAnchors = matchDetectionsToSeats(
    seatAnchors,
    poses.map((p) => ({
      x: p.x,
      y: p.y,
      landmarks: p.landmarks,
    })),
    { maxDistance: 0.22, yWeight: TRACK_MATCH_Y_WEIGHT, maxMissed: TRACK_MAX_MISSED },
  );
  numberingSlots = seatsToNumberingSlots(seatAnchors);
}

async function lockNumbering(payload: PersonPoint[], tracked: TrackedPose[]): Promise<void> {
  if (sortInFlight) return;
  sortInFlight = true;
  try {
    if (!apiOk) await checkHealth();
    const sorted = apiOk ? await sortViaPython(payload) : sortLocal(payload);
    if (apiOk) setApiStatus(true, "编号已锁定");
    applyLockFromSort(sorted);
    seedSeatsFromPoses(
      tracked.map((t) => ({
        x: t.center.x,
        y: t.center.y,
        landmarks: t.landmarks,
      })),
    );
    const faceBound = await captureFaceTemplatesForSeats();
    race = new FirstRaiseTracker();
    // Prime as "not raised" so already-up hands in the video still count as a rising edge.
    race.update(
      sorted.people.map((p) => ({ personIndex: p.index, raised: false })),
      performance.now(),
    );
    lastUiKey = "";
    lastWinnerKey = "";
    publishClassroomEvent({
      type: "numbering-locked",
      seats: sorted.people.map((p) => p.index),
      source: BUS_SOURCE,
    });
    setStatus(
      `已锁定 ${sorted.count} 人座位 · 身份按座位固定 · 人脸 ${faceBound}/${sorted.count} · 开始举手检测`,
    );
  } catch {
    setApiStatus(false, "排序失败，已用本地锁定");
    const local = sortLocal(payload);
    applyLockFromSort(local);
    seedSeatsFromPoses(
      tracked.map((t) => ({
        x: t.center.x,
        y: t.center.y,
        landmarks: t.landmarks,
      })),
    );
    const faceBound = await captureFaceTemplatesForSeats();
    race = new FirstRaiseTracker();
    race.update(
      local.people.map((p) => ({ personIndex: p.index, raised: false })),
      performance.now(),
    );
    publishClassroomEvent({
      type: "numbering-locked",
      seats: local.people.map((p) => p.index),
      source: BUS_SOURCE,
    });
    setStatus(
      `本地锁定 ${payload.length} 人座位 · 身份按座位固定 · 人脸 ${faceBound}/${payload.length} · 开始举手检测`,
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

  if (locked) {
    for (const f of lastFaceBoxes) {
      ctx.strokeStyle = "rgba(61, 156, 253, 0.55)";
      ctx.lineWidth = 2;
      ctx.strokeRect(f.xMin * w, f.yMin * h, f.width * w, f.height * h);
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
      let text: string;
      if (isWinner) text = `#${index} 最先`;
      else if (raised) text = `#${index} 举手`;
      else text = `#${index}`;
      ctx.fillText(text, seat.x * w - 14, seat.y * h - 16);
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
  race = new FirstRaiseTracker();
  lastUiKey = "";
  renderWinner(null);
  publishClassroomEvent({ type: "numbering-cleared", source: BUS_SOURCE });
}

async function loop(nowMs: number): Promise<void> {
  raf = requestAnimationFrame((t) => void loop(t));
  if (!detecting || !landmarker || video.readyState < 2) return;
  if (video.paused || video.ended || seeking) {
    updateTimeUi();
    return;
  }
  if (!ensureCanvasSize()) return;
  const interval = countLock.locked ? DETECT_INTERVAL_LOCKED_MS : DETECT_INTERVAL_MS;
  if (nowMs - lastTs < interval) return;
  lastTs = nowMs;

  const raw = detectPosesMultiBand(landmarker, video, frameCanvas, bandCanvas);
  const expected = readExpectedCount();
  // After lock: do not reshuffle seats every frame. Only collapse true duplicates.
  const poses = countLock.locked
    ? collapseByMinGapX(
        dedupeRowPoses(raw, { duplicateDistance: 0.032, minSeparationX: 0.035 }),
        0.034,
      )
    : selectPosesBySeatBins(raw, {
        expectedCount: expected,
        duplicateDistance: 0.032,
        minSeparationX: 0.035,
        minSeatGap: 0.036,
      });

  updateTimeUi();

  // ——— Locked: identity = seat index (not MediaPipe trackId) ———
  if (countLock.locked) {
    seatAnchors = matchDetectionsToSeats(
      seatAnchors,
      poses.map((p) => {
        const c = torsoCenter(p.landmarks);
        return { x: c.x, y: c.y, landmarks: p.landmarks };
      }),
      {
        maxDistance: 0.18,
        yWeight: TRACK_MATCH_Y_WEIGHT,
        maxMissed: TRACK_MAX_MISSED,
      },
    );

    // Per-seat crop re-detect → larger person → stabler shoulders/wrists.
    const refined = refineSeatsWithCrops(
      landmarker,
      frameCanvas,
      cropCanvas,
      seatAnchors.map((s) => ({ x: s.x, y: s.y })),
      { halfW: 0.1, halfH: 0.18, padTop: 0.24, maxTorsoDist: 0.15 },
    );
    for (let i = 0; i < seatAnchors.length; i++) {
      const seat = seatAnchors[i]!;
      const crop = refined[i];
      const base = crop?.landmarks ?? seat.landmarks;
      if (!base) continue;
      seat.landmarks = emaBlendLandmarks(seat.landmarks, base as PoseLandmark[], LANDMARK_EMA_ALPHA);
      if (crop) {
        const c = torsoCenter(seat.landmarks);
        seat.x = c.x;
        seat.y = c.y;
        seat.fresh = true;
        seat.missed = 0;
      }
    }

    numberingSlots = seatsToNumberingSlots(seatAnchors);
    refreshFaceDescriptorsForSeats(nowMs);
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

    const raisedIndexes = people.filter((p) => p.raised).map((p) => p.index);
    const missed = seatAnchors.filter((s) => !s.fresh).length;
    if (winner) {
      setStatus(`最先举手：#${winner.personIndex} · 「下一轮」再赛 · 「重新编号」可重排`);
    } else if (missed > 0) {
      setStatus(
        `座位锁定 ${people.length} · 在场 ${liveSeats} · 人脸 ${faceBound} · ${missed} 座短暂丢失（编号不变）`,
      );
    } else if (raisedIndexes.length === 0) {
      setStatus(`座位锁定 ${people.length} 人 · 局部重检+平滑 · 等待举手…`);
    } else {
      setStatus(`举手中：${raisedIndexes.map((n) => `#${n}`).join("、")}`);
    }
    return;
  }

  // ——— Pre-lock: temporary PoseTracker ids only for sorting ———
  const trackedAll = tracker.update(poses);
  const fresh = trackedAll.filter((t) => t.fresh);
  const tracked = (fresh.length >= expected ? fresh : trackedAll).slice(0, expected);
  const payload = tracked.map((t) => ({
    id: t.trackId,
    x: torsoCenter(t.landmarks).x,
    y: torsoCenter(t.landmarks).y,
  }));
  const liveCount = payload.length;

  const observed = observePersonCount(countLock, liveCount, {
    expectedCount: expected,
    minStableFrames: LOCK_STABLE_FRAMES,
  });
  countLock = observed.state;
  renderHud(liveCount, [], null, false);
  drawOverlay(tracked, [], null, false);

  if (observed.shouldLock) {
    setStatus(`人数已达 ${expected} · 正在 Python 排序锁定…`);
    await lockNumbering(payload, tracked);
  } else if (liveCount === expected) {
    setStatus(
      `人数 ${liveCount}/${expected} · 稳定中 ${countLock.streak}/${LOCK_STABLE_FRAMES} 帧（分条 ${raw.length}→座位 ${poses.length}）`,
    );
  } else {
    setStatus(
      `等待出镜人数达到 ${expected}（当前 ${liveCount}，分条 ${raw.length}→座位 ${poses.length}）· 暂不排序`,
    );
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
  stopDetection({ keepFile: false });
  revokeObjectUrl();
  objectUrl = URL.createObjectURL(file);
  video.srcObject = null;
  video.src = objectUrl;
  video.load();
  fileNameEl.textContent = file.name;
  btnStart.disabled = false;
  seekEl.disabled = false;
  setStatus(`已加载「${file.name}」· 点「开始检测」播放并分析`);
}

async function onStart(): Promise<void> {
  if (!video.src && !objectUrl) {
    setStatus("请先选择视频文件");
    return;
  }
  btnStart.disabled = true;
  setStatus("加载 Pose 模型…");
  try {
    await checkHealth();
    landmarker = await createPoseLandmarker({
      numPoses: 6,
      runningMode: "IMAGE",
      modelAssetPath: FULL_MODEL_URL,
      minPoseDetectionConfidence: 0.28,
      minPosePresenceConfidence: 0.28,
      minTrackingConfidence: 0.28,
    });
    try {
      const faceSt = await fetchQwenFaceStatus();
      qwenFaceOk = !!faceSt.configured;
      if (qwenFaceOk) {
        setApiStatus(true, `千问人脸 · ${faceSt.model ?? "qwen-vl"}`);
      } else {
        setApiStatus(apiOk, "千问人脸未配置 · 仅位置绑座");
      }
    } catch {
      qwenFaceOk = false;
    }
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
    btnPause.disabled = false;
    btnReset.disabled = false;
    btnRelock.disabled = false;
    await video.play();
    btnPause.textContent = "暂停视频";
    setStatus(
      qwenFaceOk
        ? `检测中 · 等待 ${readExpectedCount()} 人（千问人脸绑座）`
        : `检测中 · 等待 ${readExpectedCount()} 人 · 未配置千问，仅位置绑座`,
    );
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame((t) => void loop(t));
  } catch (err) {
    console.error(err);
    setStatus(err instanceof Error ? err.message : "启动失败");
    detecting = false;
    btnStart.disabled = false;
    landmarker?.close();
    landmarker = null;
  }
}

function stopDetection(opts?: { keepFile?: boolean }): void {
  cancelAnimationFrame(raf);
  raf = 0;
  detecting = false;
  video.pause();
  landmarker?.close();
  landmarker = null;
  qwenFaceOk = false;
  tracker.reset();
  clearNumberingLock();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  renderHud(0, [], null, false);
  btnStart.disabled = !(objectUrl || video.src);
  btnStop.disabled = true;
  btnPause.disabled = true;
  btnReset.disabled = true;
  btnRelock.disabled = true;
  btnPause.textContent = "暂停视频";
  if (!opts?.keepFile) {
    /* file kept by default when stopping detect */
  }
  setStatus(objectUrl ? "已停止检测 · 可再次「开始检测」或换文件" : "已停止");
}

function onStop(): void {
  stopDetection({ keepFile: true });
}

function onTogglePause(): void {
  if (!detecting) return;
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
  race.reset();
  lastUiKey = "";
  renderWinner(null);
  publishClassroomEvent({ type: "race-reset", source: BUS_SOURCE });
  setStatus("已重置本轮 · 编号保持 · 等待最先举手");
}

function onRelock(): void {
  clearNumberingLock();
  tracker.reset();
  setStatus(`已解除编号 · 等待 ${readExpectedCount()} 人出镜后重新排序`);
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
  tracker.reset();
  clearNumberingLock();
  setStatus(`已跳转至 ${formatTime(video.currentTime)} · 编号已清除，将重新锁定`);
});

video.addEventListener("loadedmetadata", () => {
  seekEl.max = String(video.duration || 0);
  updateTimeUi();
  canvasSized = false;
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
