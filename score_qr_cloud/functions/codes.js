import { SLOT_COUNT } from "./_lib/constants.js";
import { ensureSchema, listSlots, updateSlotNames } from "./_lib/db.js";
import { html, redirect } from "./_lib/http.js";
import { livePage } from "./_lib/pages.js";
import { parseNames } from "./_lib/validate.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  await ensureSchema(env.DB);
  const form = await request.formData();
  const raw = Array.from({ length: SLOT_COUNT }, (_, i) => form.get(`name${i + 1}`));
  const parsed = parseNames(raw);
  const slots = await listSlots(env.DB);

  if (parsed.error) {
    return html(livePage({ cleared: false, slots, error: parsed.error }), 400);
  }

  await updateSlotNames(env.DB, parsed.names);
  return redirect("/?saved=1");
}
