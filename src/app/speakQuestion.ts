/**
 * Browser TTS for reading MCQ stem + A/B/C/D options (not the answer key).
 */

export type QuestionOptions = Partial<Record<"A" | "B" | "C" | "D", string>>;

export type SpeakableQuestion = {
  id: string;
  answer: string;
  prompt?: string;
  options?: QuestionOptions;
};

const OPTION_ORDER = ["A", "B", "C", "D"] as const;

/** Build spoken script: stem + options. Never includes `answer`. */
export function buildQuestionSpeechText(q: SpeakableQuestion): string {
  const parts: string[] = [];
  const prompt = q.prompt?.trim();
  if (prompt) {
    parts.push(prompt);
  } else {
    parts.push(`题目 ${q.id}`);
  }

  const opts = q.options;
  if (opts) {
    for (const key of OPTION_ORDER) {
      const text = opts[key]?.trim();
      if (text) {
        parts.push(`选项${key}，${text}`);
      }
    }
  }

  return parts.join("。");
}

function pickZhVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  const zh =
    voices.find((v) => /^zh(-|_)/i.test(v.lang) && /CN|China|Chinese/i.test(v.name + v.lang)) ||
    voices.find((v) => /^zh/i.test(v.lang));
  return zh ?? null;
}

export function stopSpeaking(): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
}

export type SpeakOptions = {
  lang?: string;
  rate?: number;
  onEnd?: () => void;
  onError?: (message: string) => void;
};

/** Speak question stem + ABCD. Cancels any ongoing utterance first. */
export function speakQuestion(q: SpeakableQuestion, opts: SpeakOptions = {}): boolean {
  if (typeof window === "undefined" || !window.speechSynthesis) {
    opts.onError?.("当前浏览器不支持语音播报");
    return false;
  }

  const text = buildQuestionSpeechText(q);
  if (!text.trim()) {
    opts.onError?.("本题没有可朗读的题干或选项");
    return false;
  }

  stopSpeaking();

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = opts.lang ?? "zh-CN";
  utter.rate = opts.rate ?? 0.95;
  const voice = pickZhVoice();
  if (voice) utter.voice = voice;

  utter.onend = () => opts.onEnd?.();
  utter.onerror = () => opts.onError?.("播报失败或被中断");

  // Some browsers need voices loaded asynchronously.
  const start = () => window.speechSynthesis.speak(utter);
  if (window.speechSynthesis.getVoices().length === 0) {
    window.speechSynthesis.onvoiceschanged = () => {
      const v = pickZhVoice();
      if (v) utter.voice = v;
      window.speechSynthesis.onvoiceschanged = null;
      start();
    };
  } else {
    start();
  }
  return true;
}
