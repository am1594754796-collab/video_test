/**
 * Pull the last A–D choice from a speech transcript (zh / en letter forms).
 */

const LETTER = "ABCD" as const;
export type ChoiceLetter = (typeof LETTER)[number];

const CN_TO_LETTER: Record<string, ChoiceLetter> = {
  甲: "A",
  乙: "B",
  丙: "C",
  丁: "D",
};

/** Match Latin A–D or 甲乙丙丁 as standalone option tokens. */
const TOKEN =
  /(?:^|[^A-Za-z0-9])([A-Da-d]|[甲乙丙丁])(?=[^A-Za-z0-9]|$)/g;

export function extractLastChoiceLetter(transcript: string): ChoiceLetter | null {
  const text = transcript.trim();
  if (!text) return null;

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
