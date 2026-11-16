import { ensureSchema, listSlots, recentScores, summaryForCode } from "./_lib/db.js";
import { html, publicBase } from "./_lib/http.js";
import { adminPage } from "./_lib/pages.js";
import { validCode } from "./_lib/validate.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  await ensureSchema(env.DB);
  const url = new URL(request.url);
  const code = (url.searchParams.get("code") || "").trim();
  let lookup = null;
  let error = null;
  if (code) {
    if (!validCode(code)) {
      error = "编号只能是 1–32 位字母、数字、中文、下划线或连字符。";
    } else {
      lookup = await summaryForCode(env.DB, code);
    }
  }
  const slots = await listSlots(env.DB);
  const recent = await recentScores(env.DB);
  const rows = [];
  for (const slot of slots) rows.push(await summaryForCode(env.DB, slot.code));
  return html(
    adminPage({
      slots,
      rows,
      recent,
      lookup,
      lookupCode: code,
      error,
      publicBase: publicBase(request),
    }),
  );
}
