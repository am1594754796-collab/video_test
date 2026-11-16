import { CODE_RE, COMMENT_MAX, RATE_TITLE_MAX, SCORE_MAX, SCORE_MIN, SLOT_COUNT } from "./constants.js";

export function validCode(code) {
  return CODE_RE.test(code);
}

export function parseCodes(raw, slotCount = SLOT_COUNT) {
  const codes = raw.map((item) => String(item ?? "").trim());
  if (codes.length !== slotCount) return { error: `需要正好 ${slotCount} 个编号。` };
  if (codes.some((code) => !validCode(code))) {
    return { error: "每个编号只能是 1–32 位字母、数字、中文、下划线或连字符。" };
  }
  if (new Set(codes).size !== slotCount) return { error: "编号不能重复。" };
  return { codes };
}

/** Display names shown on the board and rating picker. */
export function parseNames(raw, slotCount = SLOT_COUNT) {
  const names = raw.map((item) => String(item ?? "").trim().replace(/\s+/g, " "));
  if (names.length !== slotCount) return { error: `需要正好 ${slotCount} 个名称。` };
  if (names.some((name) => name.length < 1 || name.length > 32)) {
    return { error: "每个名称需为 1–32 个字。" };
  }
  if (new Set(names).size !== slotCount) return { error: "名称不能重复。" };
  return { names };
}

/** Title shown on the shared rating page. */
export function parseRateTitle(raw) {
  const title = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (title.length < 1 || title.length > RATE_TITLE_MAX) {
    return { error: `扫码页标题需为 1–${RATE_TITLE_MAX} 个字。` };
  }
  return { title };
}

export function parseSubmission(form) {
  const rawScore = form.get("score") ?? "";
  const allowed = new Set(Array.from({ length: SCORE_MAX - SCORE_MIN + 1 }, (_, i) => String(SCORE_MIN + i)));
  if (!allowed.has(rawScore)) return { error: "请输入 0 到 100 的整数分数。" };
  const comment = String(form.get("comment") ?? "").trim();
  if (comment.length > COMMENT_MAX) return { error: "备注请控制在 200 字以内。" };
  return { score: Number(rawScore), comment };
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
