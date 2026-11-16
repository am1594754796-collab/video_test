import { ensureSchema, liveRows } from "../_lib/db.js";
import { json } from "../_lib/http.js";

export async function onRequestGet(context) {
  await ensureSchema(context.env.DB);
  const rows = await liveRows(context.env.DB);
  return json({ rows }, 200, { "Cache-Control": "no-store" });
}
