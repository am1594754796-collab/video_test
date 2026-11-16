import { ensureSchema, listSlots, scoresForCode, summaryForCode } from "../../_lib/db.js";
import { json } from "../../_lib/http.js";
export async function onRequestGet(context) {
  const slotNumber = Number(context.params.slot);
  if (!Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 6) return json({ error: "编号不存在" }, 404);
  await ensureSchema(context.env.DB);
  const slot = (await listSlots(context.env.DB)).find((item) => item.slot === slotNumber);
  if (!slot) return json({ error: "编号不存在" }, 404);
  return json({ slot, summary: await summaryForCode(context.env.DB, slot.code), records: await scoresForCode(context.env.DB, slot.code) }, 200, { "Cache-Control": "no-store" });
}
