/**
 * Play prebuilt CosyVoice MP3s from the question bank (no live synthesis).
 */

export type QuestionOptions = Partial<Record<"A" | "B" | "C" | "D", string>>;

export type SpeakableQuestion = {
  id: string;
  answer: string;
  prompt?: string;
  options?: QuestionOptions;
  has_audio?: boolean;
};

export type SpeakOptions = {
  /** Client-side playbackRate (prebuilt files are fixed-rate). Default 1. */
  rate?: number;
  onEnd?: () => void;
  onError?: (message: string) => void;
};

export type RaiseCountdownOptions = SpeakOptions & {
  onTick?: (n: 3 | 2 | 1) => void;
};

export const RAISE_COUNTDOWN_AUDIO_ID = "raise-countdown";

type Playback = {
  abort: AbortController;
  audio: HTMLAudioElement | null;
  url: string | null;
  timers: number[];
};

let current: Playback | null = null;

const SILENT_MP3 =
  "data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAA4T/kQAAAAA=";

function clearTimers(playback: Playback): void {
  for (const id of playback.timers) window.clearTimeout(id);
  playback.timers = [];
}

function release(playback: Playback): void {
  clearTimers(playback);
  if (playback.audio) {
    playback.audio.onended = null;
    playback.audio.onerror = null;
    playback.audio.pause();
    playback.audio.src = "";
  }
  if (playback.url) URL.revokeObjectURL(playback.url);
}

export function stopSpeaking(): void {
  const playback = current;
  current = null;
  if (!playback) return;
  playback.abort.abort();
  release(playback);
}

async function playCachedUrl(
  url: string,
  opts: SpeakOptions,
  afterStart?: (playback: Playback) => void,
): Promise<boolean> {
  stopSpeaking();
  const playback: Playback = {
    abort: new AbortController(),
    audio: new Audio(SILENT_MP3),
    url: null,
    timers: [],
  };
  current = playback;
  void playback.audio.play().catch(() => undefined);

  const rate = opts.rate ?? 1;
  try {
    const res = await fetch(url, { signal: playback.abort.signal });
    if (current !== playback) return false;
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { detail?: string };
      opts.onError?.(body.detail || `播报失败 HTTP ${res.status}`);
      if (current === playback) current = null;
      release(playback);
      return false;
    }
    const blob = await res.blob();
    if (current !== playback) return false;
    const objectUrl = URL.createObjectURL(blob);
    playback.url = objectUrl;
    const audio = playback.audio ?? new Audio();
    playback.audio = audio;
    audio.src = objectUrl;
    audio.playbackRate = Math.min(2, Math.max(0.5, rate));
    audio.onended = () => {
      if (current !== playback) return;
      current = null;
      release(playback);
      opts.onEnd?.();
    };
    audio.onerror = () => {
      if (current !== playback) return;
      current = null;
      release(playback);
      opts.onError?.("播报失败或被中断");
    };
    await audio.play();
    if (current === playback) afterStart?.(playback);
    return true;
  } catch (err) {
    if (current === playback) current = null;
    release(playback);
    if (err instanceof DOMException && err.name === "AbortError") return false;
    const message = err instanceof Error ? err.message : "播报失败";
    opts.onError?.(message);
    return false;
  }
}

/** Play prebuilt question MP3. */
export async function speakQuestion(
  q: SpeakableQuestion,
  opts: SpeakOptions = {},
): Promise<boolean> {
  if (q.has_audio === false) {
    opts.onError?.(`缺少 ${q.id}.mp3：请先预生成题库语音`);
    return false;
  }
  return playCachedUrl(`/api/speech/audio/${encodeURIComponent(q.id)}`, opts);
}

/** Play prebuilt raise-hand countdown MP3 + visual ticks. */
export async function speakRaiseHandCountdown(opts: RaiseCountdownOptions = {}): Promise<boolean> {
  const rate = opts.rate ?? 1;
  const tickMs = Math.max(550, Math.round(900 / rate));

  return playCachedUrl(
    `/api/speech/audio/${encodeURIComponent(RAISE_COUNTDOWN_AUDIO_ID)}`,
    opts,
    (playback) => {
      const steps: Array<3 | 2 | 1> = [3, 2, 1];
      steps.forEach((n, i) => {
        const id = window.setTimeout(() => {
          if (current !== playback) return;
          opts.onTick?.(n);
        }, i * tickMs);
        playback.timers.push(id);
      });
    },
  );
}
