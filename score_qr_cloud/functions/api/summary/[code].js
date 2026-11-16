import { ensureSchema, summaryForCode } from "../../_lib/db.js";
import { json } from "../../_lib/http.js";
import { validCode } from "../../_lib/validate.js";

export async function onRequestGet(context) {
  const code = context.params.code;
  if (!validCode(code)) return json({ error: "bad code" }, 400);
  await ensureSchema(context.env.DB);
  return json(await summaryForCode(context.env.DB, code));
}
