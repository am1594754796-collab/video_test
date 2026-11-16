/**
 * Independent hand-raise vision page: camera preview + detection HUD + race.
 * Owns the USB camera; classroom / scoreboard talk over classroomBus.
 */

import {
  publishClassroomEvent,
  subscribeClassroomEvents,
  type ClassroomEvent,
} from "./classroomBus";
import {
  BackgroundRaiseSession,
  type RaiseHudFrame,
} from "./backgroundRaiseDetect";
import { drawRaiseHud } from "./drawRaiseHud";
import { RaiseRaceRound } from "../round";

const BUS_SOURCE = "vision";
/** Classroom default (vision.html): shoulder pose only. Face lock is vision-face.html. */
const identityMode: "pose" | "face" =
  /vision-face\.html$/i.test(window.location.pathname) ? "face" : "pose";
const TAB_ID = `vision-${Math.random().toString(36).slice(2, 10)}`;

const video = document.querySelector<HTMLVideoElement>("#camera")!;
const hud = document.querySelector<HTMLCanvasElement>("#hud")!;
const statusEl = document.querySelector<HTMLElement>("#status")!;
const raceStatusEl = document.querySelector<HTMLElement>("#race-status")!;
const seatList = document.querySelector<HTMLElement>("#seat-list")!;
const expectedCountInput = document.querySelector<HTMLInputElement>("#expected-count")!;
const btnRestart = document.querySelector<HTMLButtonElement>("#btn-restart")!;

/** Settle 1s so near-simultaneous raises can still compete after open. */
const race = new RaiseRaceRound({ openGraceMs: 0, settleMs: 1000 });
let detect: BackgroundRaiseSession | null = null;
let lastHud: RaiseHudFrame | null = null;
let winnerIndex: number | null = null;
let lockedSeats: number[] = [];
let starting = false;
let raf = 0;

function cameraBusyMessage(raw: string): string | null {
  if (/NotAllowedError|Permission denied|PermissionDenied/i.test(raw)) {
    return "请允许摄像头后点击「重新检测并排序」";
  }
  if (/NotReadableError|TrackStartError|Device in use|Could not start video source|in use/i.test(raw)) {
    return "摄像头被占用：请关闭其他「举手识别」标签页或占用相机的软件，再点「重新检测并排序」";
  }
  return null;
}

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function setRaceStatus(text: string): void {
  raceStatusEl.textContent = text;
}

function expectedCount(): number {
  return Math.min(6, Math.max(1, Math.trunc(Number(expectedCountInput.value) || 1)));
}

function renderSeatList(frame: RaiseHudFrame | null): void {
  seatList.innerHTML = "";
  if (!frame || frame.people.length === 0) return;
  for (const p of [...frame.people].sort((a, b) => a.index - b.index)) {
    const li = document.createElement("li");
    li.textContent = p.raised ? `#${p.index} 举手` : `#${p.index}`;
    if (p.raised) li.classList.add("raised");
    if (winnerIndex === p.index) li.classList.add("winner");
    seatList.appendChild(li);
  }
}

function paintLoop(): void {
  raf = requestAnimationFrame(paintLoop);
  drawRaiseHud(hud, video, lastHud);
}

function phaseLabel(): string {
  switch (race.phase) {
    case "countdown":
      return "倒计时中 · 提前举手将扣分";
    case "open":
      return "可抢答";
    case "locked":
      return winnerIndex != null ? `本轮锁定 #${winnerIndex}` : "本轮已锁定";
    default:
      return "等待课堂页开始倒计时";
  }
}

function applyRaceOut(events: ReturnType<RaiseRaceRound["feed"]>): void {
  for (const e of events) {
    if (e.type === "early-raise") {
      setRaceStatus(`#${e.personIndex} 提前举手 · 已通知扣分`);
      publishClassroomEvent({
        type: "early-raise",
        personIndex: e.personIndex,
        atMs: e.atMs,
        source: BUS_SOURCE,
      });
    } else if (e.type === "winner") {
      winnerIndex = e.personIndex;
      setRaceStatus(`#${e.personIndex} 抢答成功`);
      publishClassroomEvent({
        type: "first-raise",
        personIndex: e.personIndex,
        source: BUS_SOURCE,
      });
      renderSeatList(lastHud);
    }
  }
}

async function startDetect(): Promise<void> {
  if (starting) return;
  starting = true;
  btnRestart.disabled = true;
  // Ask other vision tabs to release the USB camera first.
  publishClassroomEvent({ type: "vision-camera-claim", tabId: TAB_ID, source: BUS_SOURCE });
  detect?.stop();
  detect = null;
  await new Promise((r) => window.setTimeout(r, 350));
  winnerIndex = null;
  lockedSeats = [];
  lastHud = null;
  race.resetToIdle();
  setRaceStatus(phaseLabel());
  const count = expectedCount();
  expectedCountInput.value = String(count);
  detect = new BackgroundRaiseSession(
    { video, expectedCount: count, identityMode },
    {
      onStatus: setStatus,
      onLocked: (seats) => {
        lockedSeats = [...seats];
        publishClassroomEvent({ type: "numbering-locked", seats, source: BUS_SOURCE });
        setStatus(`人数排序成功：${seats.map((n) => `#${n}`).join(" ")}`);
      },
      onCleared: () => {
        lockedSeats = [];
        winnerIndex = null;
        publishClassroomEvent({ type: "numbering-cleared", source: BUS_SOURCE });
        renderSeatList(null);
      },
      onHud: (frame) => {
        lastHud = frame;
        renderSeatList(frame);
      },
      onFrame: (people, nowMs) => {
        const raised = people.filter((p) => p.raised).map((p) => `#${p.personIndex}`);
        setStatus(
          raised.length > 0
            ? `编号已锁定 · 举手 ${raised.join("、")} · ${phaseLabel()}`
            : `编号已锁定 · 未举手 · ${phaseLabel()}`,
        );
        if (race.phase === "idle") return;
        applyRaceOut(race.feed(people, nowMs));
      },
    },
  );
  try {
    await detect.start();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const name = err instanceof DOMException ? err.name : "";
    const hint = cameraBusyMessage(`${name} ${msg}`);
    setStatus(hint ?? `检测启动失败：${msg}`);
  } finally {
    starting = false;
    btnRestart.disabled = false;
  }
}

function onBusEvent(event: ClassroomEvent): void {
  if (event.type === "vision-camera-claim") {
    if (event.tabId === TAB_ID) return;
    // Another vision tab needs the camera — release ours so it can open.
    detect?.stop();
    detect = null;
    lockedSeats = [];
    lastHud = null;
    renderSeatList(null);
    setStatus("摄像头已交给其他举手识别页 · 需要时点「重新检测并排序」");
    return;
  }
  if (event.source === BUS_SOURCE) return;
  switch (event.type) {
    case "vision-state-request":
      if (lockedSeats.length > 0) {
        publishClassroomEvent({ type: "vision-state", seats: lockedSeats, source: BUS_SOURCE });
      }
      break;
    case "raise-countdown-start":
      winnerIndex = null;
      race.beginCountdown(performance.now());
      setRaceStatus(phaseLabel());
      renderSeatList(lastHud);
      break;
    case "raise-window-open":
      race.openWindow(performance.now());
      setRaceStatus(phaseLabel());
      break;
    case "raise-round-abort":
    case "race-reset":
      winnerIndex = null;
      race.resetToIdle();
      setRaceStatus(phaseLabel());
      renderSeatList(lastHud);
      break;
    case "vision-relock-request":
      if (typeof event.expectedCount === "number" && Number.isFinite(event.expectedCount)) {
        expectedCountInput.value = String(
          Math.min(6, Math.max(1, Math.trunc(event.expectedCount))),
        );
      }
      void startDetect();
      break;
    default:
      break;
  }
}

btnRestart.addEventListener("click", () => {
  void startDetect();
});

expectedCountInput.addEventListener("change", () => {
  void startDetect();
});

subscribeClassroomEvents(onBusEvent);
paintLoop();
void startDetect();

window.addEventListener("beforeunload", () => {
  cancelAnimationFrame(raf);
  detect?.stop();
});
