import { SLOT_COUNT } from "../_lib/constants.js";
import { ensureSchema, listSlots } from "../_lib/db.js";
import { qrSvg } from "../_lib/qr.js";
import { publicBase, securityHeaders } from "../_lib/http.js";

export async function onRequestGet(context) {
  const slot = Number(context.params.slot);
  if (!Number.isInteger(slot) || slot < 1 || slot > SLOT_COUNT) return new Response("Not Found", { status: 404 });
  await ensureSchema(context.env.DB);
  if (!(await listSlots(context.env.DB)).some((item) => item.slot === slot)) return new Response("Not Found", { status: 404 });
  return new Response(qrSvg(`${publicBase(context.request)}/s/${slot}`), { headers: { ...securityHeaders(), "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "no-store" } });
}
