/**
 * Map a bank question's `answer` field to the expected A–D letter.
 */

import type { ChoiceLetter } from "./extractChoiceLetter";

export type QuestionLike = {
  answer: string;
  options?: Partial<Record<ChoiceLetter, string>>;
};

const LETTERS: ChoiceLetter[] = ["A", "B", "C", "D"];

function norm(s: string): string {
  return s.trim().replace(/\s+/g, "").toLowerCase();
}

export function expectedChoiceLetter(q: QuestionLike): ChoiceLetter | null {
  const raw = q.answer?.trim() ?? "";
  if (!raw) return null;

  const asLetter = raw.toUpperCase();
  if (asLetter === "A" || asLetter === "B" || asLetter === "C" || asLetter === "D") {
    return asLetter;
  }

  if (!q.options) return null;
  const want = norm(raw);
  for (const key of LETTERS) {
    const text = q.options[key];
    if (text != null && norm(text) === want) return key;
  }
  return null;
}
