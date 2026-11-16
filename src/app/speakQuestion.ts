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

export type RaiseCountdownDigit = 5 | 4 | 3 | 2 | 1;

export type RaiseCountdownOptions = SpeakOptions & {
  onTick?: (n: RaiseCountdownDigit) => void;
};

export const RAISE_COUNTDOWN_AUDIO_ID = "raise-countdown";

const CIRCLED_NUMBERS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
const CHINESE_NUMBERS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十"];

function spokenChoiceText(text: string): string {
  return text.replace(/[①-⑳]+/g, (match) =>
    [...match].map((char) => `第${CHINESE_NUMBERS[CIRCLED_NUMBERS.indexOf(char)]}项`).join("、"),
  );
}

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
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  const playback = current;
  current = null;
  if (!playback) return;
  playback.abort.abort();
  release(playback);
}

/** Speak the short answer verdict using the browser's Chinese voice. */
export function speakAnswerFeedback(passed: boolean, correctLetter: "A" | "B" | "C" | "D", correctText?: string): Promise<void> {
  if (typeof window === "undefined" || !window.speechSynthesis) return Promise.resolve();
  const synth = window.speechSynthesis;
  synth.cancel();
  const answer = correctText?.trim() ? `${correctLetter}，${spokenChoiceText(correctText.trim())}` : correctLetter;
  const text = passed ? "回答正确" : `回答错误，正确答案是 ${answer}`;
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 0.9;
    const timeout = window.setTimeout(resolve, 5000);
    const done = () => { window.clearTimeout(timeout); resolve(); };
    utterance.onend = done;
    utterance.onerror = done;
    synth.speak(utterance);
  });
}

/** Announce a raise-race result before the answer microphone starts. */
export function speakRaceAnnouncement(text: string, signal?: AbortSignal): Promise<void> {
  if (typeof window === "undefined" || !window.speechSynthesis) return Promise.resolve();
  if (signal?.aborted) return Promise.resolve();
  const synth = window.speechSynthesis;
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 0.9;
    const chineseVoice = synth.getVoices().find((voice) => /^zh(?:-|_)/i.test(voice.lang));
    if (chineseVoice) utterance.voice = chineseVoice;
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      synth.cancel();
      done();
    };
    const timeout = window.setTimeout(() => {
      synth.cancel();
      done();
    }, 6000);
    utterance.onend = done;
    utterance.onerror = done;
    signal?.addEventListener("abort", onAbort, { once: true });
    if (synth.paused) synth.resume();
    synth.speak(utterance);
  });
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
  const warm = playback.audio;
  if (warm) void warm.play().catch(() => undefined);

  const rate = opts.rate ?? 1;
  try {
    const res = await fetch(url, { signal: playback.abort.signal, cache: "no-store" });
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

/** Play prebuilt raise-hand countdown MP3 + visual ticks (5→1, ~1s each). */
export async function speakRaiseHandCountdown(opts: RaiseCountdownOptions = {}): Promise<boolean> {
  const rate = opts.rate ?? 1;
  const tickMs = Math.max(700, Math.round(1000 / rate));

  return playCachedUrl(
    `/api/speech/audio/${encodeURIComponent(RAISE_COUNTDOWN_AUDIO_ID)}`,
    opts,
    (playback) => {
      const steps: RaiseCountdownDigit[] = [5, 4, 3, 2, 1];
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
