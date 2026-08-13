/**
 * Cross-tab bus so independent pages (vision / speech / scoreboard) stay decoupled.
 * Prefers BroadcastChannel; falls back to localStorage for older browsers.
 */

export type ClassroomEvent =
  | { type: "numbering-locked"; seats: number[]; source?: string }
  | { type: "numbering-cleared"; source?: string }
  | { type: "first-raise"; personIndex: number; source?: string }
  | { type: "race-reset"; source?: string }
  | { type: "answer-passed"; questionId?: string; transcript?: string; source?: string }
  | { type: "scores-clear"; source?: string };

const CHANNEL = "classroom-vision-speech-score";
const STORAGE_KEY = "classroom-bus-ping";

type Handler = (event: ClassroomEvent) => void;

const handlers = new Set<Handler>();
let channel: BroadcastChannel | null = null;
let storageHooked = false;

function deliver(event: ClassroomEvent): void {
  for (const h of handlers) {
    try {
      h(event);
    } catch (err) {
      console.error("[classroomBus] handler error", err);
    }
  }
}

function onStorage(ev: StorageEvent): void {
  if (ev.key !== STORAGE_KEY || !ev.newValue) return;
  try {
    const parsed = JSON.parse(ev.newValue) as ClassroomEvent & { _t?: number };
    const { _t: _ignore, ...rest } = parsed;
    deliver(rest as ClassroomEvent);
  } catch {
    /* ignore */
  }
}

function ensureBus(): void {
  if (typeof BroadcastChannel !== "undefined") {
    if (!channel) {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = (msg: MessageEvent<ClassroomEvent>) => {
        if (msg.data && typeof msg.data === "object" && "type" in msg.data) {
          deliver(msg.data);
        }
      };
    }
    return;
  }
  if (!storageHooked && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
    storageHooked = true;
  }
}

export function publishClassroomEvent(event: ClassroomEvent): void {
  ensureBus();
  if (channel) {
    channel.postMessage(event);
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...event, _t: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function subscribeClassroomEvents(handler: Handler): () => void {
  ensureBus();
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}
