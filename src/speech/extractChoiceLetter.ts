/**
 * Pull the last A–D choice from a speech transcript (zh / en letter forms).
 */

export type ChoiceLetter = "A" | "B" | "C" | "D";

const CN_TO_LETTER: Record<string, ChoiceLetter> = {
  甲: "A",
  乙: "B",
  丙: "C",
  丁: "D",
};

const SPOKEN_LETTER: Record<string, ChoiceLetter> = {
  诶: "A", 哎: "A", 艾: "A", 诶诶: "A",
  比: "B", 逼: "B", 哔: "B",
  西: "C", 希: "C", 吸: "C",
  迪: "D", 弟: "D", 滴: "D",
  ay: "A", bee: "B", see: "C", dee: "D",
};

/** Match Latin A–D or 甲乙丙丁 as standalone option tokens. */
const TOKEN =
  /(?:^|[^A-Za-z0-9])([A-Da-d]|[甲乙丙丁])(?=[^A-Za-z0-9]|$)/g;

export function extractLastChoiceLetter(transcript: string): ChoiceLetter | null {
  const text = transcript.trim();
  if (!text) return null;

  const spoken = text.replace(/[\s，。！？,.!?]/g, "").replace(/^(?:我选|选|答案是|答案|我觉得是)/, "").toLowerCase();
  if (spoken in SPOKEN_LETTER) return SPOKEN_LETTER[spoken]!;

  let last: ChoiceLetter | null = null;
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(text)) !== null) {
    const raw = m[1]!;
    const upper = raw.toUpperCase();
    if (upper === "A" || upper === "B" || upper === "C" || upper === "D") {
      last = upper;
    } else if (raw in CN_TO_LETTER) {
      last = CN_TO_LETTER[raw]!;
    }
  }
  return last;
}
