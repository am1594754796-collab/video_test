/**
 * Listen via Web Speech in fixed windows until an A–D choice is heard (last wins).
 *
 * Each window lasts `windowMs` (default 5s). At window end: if any A–D was heard,
 * resolve with the last one; otherwise clear and wait another window.
 */

import { extractLastChoiceLetter, type ChoiceLetter } from "./extractChoiceLetter";

export const LISTEN_WINDOW_MS = 5000;

export type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export type SpeechRecognitionResultEventLike = {
  resultIndex: number;
  results: {
    length: number;
    [i: number]: { isFinal: boolean; 0?: { transcript: string } };
  };
};

type SpeechRecCtor = new () => SpeechRecognitionLike;

export type ListenForChoiceOptions = {
  windowMs?: number;
  lang?: string;
  onWaiting?: () => void;
  onTranscript?: (text: string, letter: ChoiceLetter | null) => void;
  signal?: AbortSignal;
  createRecognition?: () => SpeechRecognitionLike;
};

export type ListenForChoiceResult =
  | { ok: true; letter: ChoiceLetter; transcript: string }
  | { ok: false; reason: "aborted" | "unsupported" | "error"; message?: string };

function getSpeechRecognitionCtor(): SpeechRecCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecCtor;
    webkitSpeechRecognition?: SpeechRecCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function listenForChoice(
  opts: ListenForChoiceOptions = {},
): Promise<ListenForChoiceResult> {
  const windowMs = opts.windowMs ?? LISTEN_WINDOW_MS;
  const lang = opts.lang ?? "zh-CN";
  const Ctor = opts.createRecognition ? null : getSpeechRecognitionCtor();

  if (!opts.createRecognition && !Ctor) {
    return Promise.resolve({
      ok: false,
      reason: "unsupported",
      message: "当前浏览器不支持语音识别（请用 Chrome / Edge）",
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    let buffer = "";
    let windowTimer = 0;
    let rec: SpeechRecognitionLike | null = null;
    /** True when we stopped recognition to roll into the next listen window. */
    let rollingWindow = false;
    /** True when we should keep the same window timer after a spontaneous onend. */
    let keepWindow = false;

    const finish = (result: ListenForChoiceResult) => {
      if (settled) return;
      settled = true;
      opts.signal?.removeEventListener("abort", onAbort);
      window.clearTimeout(windowTimer);
      try {
        rec?.abort();
      } catch {
        /* ignore */
      }
      rec = null;
      resolve(result);
    };

    const onAbort = () => finish({ ok: false, reason: "aborted" });

    if (opts.signal?.aborted) {
      finish({ ok: false, reason: "aborted" });
      return;
    }
    opts.signal?.addEventListener("abort", onAbort);

    const letterFromBuffer = (): ChoiceLetter | null => {
      const letter = extractLastChoiceLetter(buffer);
      opts.onTranscript?.(buffer, letter);
      return letter;
    };

    const armWindow = () => {
      window.clearTimeout(windowTimer);
      windowTimer = window.setTimeout(() => {
        if (settled) return;
        const letter = letterFromBuffer();
        if (letter) {
          finish({ ok: true, letter, transcript: buffer.trim() });
          return;
        }
        opts.onWaiting?.();
        buffer = "";
        rollingWindow = true;
        keepWindow = false;
        try {
          rec?.stop();
        } catch {
          startSession(true);
        }
      }, windowMs);
    };

    const startSession = (newWindow: boolean) => {
      if (settled) return;
      rollingWindow = false;

      try {
        rec?.abort();
      } catch {
        /* ignore */
      }

      const next = opts.createRecognition ? opts.createRecognition() : new Ctor!();
      rec = next;
      next.lang = lang;
      next.continuous = true;
      next.interimResults = true;
      next.maxAlternatives = 1;

      next.onresult = (ev) => {
        let chunk = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          chunk += ev.results[i]?.[0]?.transcript ?? "";
        }
        if (!chunk) return;
        buffer += (buffer ? " " : "") + chunk;
        letterFromBuffer();
      };

      next.onerror = (ev) => {
        if (settled) return;
        if (ev.error === "aborted" || ev.error === "no-speech") return;
        if (ev.error === "not-allowed") {
          finish({
            ok: false,
            reason: "error",
            message: "请允许麦克风权限后重试",
          });
        }
      };

      next.onend = () => {
        if (settled) return;
        if (opts.signal?.aborted) {
          finish({ ok: false, reason: "aborted" });
          return;
        }
        if (rollingWindow) {
          startSession(true);
          return;
        }
        // Spontaneous end mid-window: restart recognition, keep buffer + timer.
        keepWindow = true;
        startSession(false);
      };

      try {
        next.start();
        if (newWindow || !keepWindow) armWindow();
        keepWindow = false;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        finish({ ok: false, reason: "error", message: msg });
      }
    };

    startSession(true);
  });
}
