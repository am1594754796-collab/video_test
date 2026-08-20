/**
 * Shared helpers for speech pages: question list + preview of stem/options.
 */

import type { SpeakableQuestion } from "./speakQuestion";

export type BankQuestion = SpeakableQuestion;

const OPTION_ORDER = ["A", "B", "C", "D"] as const;

export function fillQuestionSelect(
  select: HTMLSelectElement,
  questions: BankQuestion[],
): void {
  select.innerHTML = "";
  for (const q of questions) {
    const opt = document.createElement("option");
    opt.value = q.id;
    const hint = q.prompt?.trim() ? truncate(q.prompt.trim(), 28) : `答案：${q.answer}`;
    opt.textContent = `${q.id} · ${hint}`;
    select.appendChild(opt);
  }
}

export function findQuestion(
  questions: BankQuestion[],
  id: string,
): BankQuestion | undefined {
  return questions.find((q) => q.id === id);
}

export function renderQuestionPreview(
  root: HTMLElement | null,
  q: BankQuestion | undefined,
): void {
  if (!root) return;
  const promptEl = root.querySelector<HTMLElement>(".qp-prompt");
  const listEl = root.querySelector<HTMLOListElement>(".qp-options");
  if (!promptEl || !listEl) return;

  if (!q) {
    promptEl.textContent = "请选择题目";
    listEl.innerHTML = "";
    listEl.hidden = true;
    return;
  }

  promptEl.textContent = q.prompt?.trim() || `（${q.id} 无题干，仅有标准答案供匹配）`;
  listEl.innerHTML = "";
  let hasOpt = false;
  if (q.options) {
    for (const key of OPTION_ORDER) {
      const text = q.options[key]?.trim();
      if (!text) continue;
      hasOpt = true;
      const li = document.createElement("li");
      li.textContent = `${key}. ${text}`;
      listEl.appendChild(li);
    }
  }
  listEl.hidden = !hasOpt;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}
