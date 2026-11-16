import { alreadyScored, ensureSchema, listSlots } from "./_lib/db.js";
import { getDeviceId, html, withDeviceCookie } from "./_lib/http.js";
import { alreadyPage, donePage, ratePage } from "./_lib/pages.js";
import { parseSubmission } from "./_lib/validate.js";

export async function onRequest(context) {
  const { request, env } = context;
  await ensureSchema(env.DB);
  const deviceId = getDeviceId(request);

  const slots = await listSlots(env.DB);
  const lockedSlot = context.params?.slot ? slots.find((row) => String(row.slot) === String(context.params.slot)) : null;
  if (context.params?.slot && !lockedSlot) return html("编号不存在", 404);
  if (lockedSlot && await alreadyScored(env.DB, deviceId, lockedSlot.code)) {
    return withDeviceCookie(html(alreadyPage(lockedSlot.name), request.method === "POST" ? 409 : 200), deviceId);
  }

  if (request.method === "GET") {
    return withDeviceCookie(
      html(ratePage({ slots, selectedSlot: "", selectedScore: "", error: null, lockedSlot })),
      deviceId,
    );
  }

  if (request.method !== "POST") {
    return html("Method Not Allowed", 405);
  }

  const form = await request.formData();
  const selectedSlot = lockedSlot ? String(lockedSlot.slot) : String(form.get("slot") ?? "");
  const slot = slots.find((row) => String(row.slot) === selectedSlot);
  let { score, comment, error } = parseSubmission(form);
  if (!slot) error = `请选择 1–${slots.length || 2} 号。`;
  if (error) {
    return withDeviceCookie(
      html(
        ratePage({
          slots,
          selectedSlot,
          selectedScore: String(form.get("score") ?? ""),
          error,
          lockedSlot,
        }),
        400,
      ),
      deviceId,
    );
  }

  if (await alreadyScored(env.DB, deviceId, slot.code)) {
    return withDeviceCookie(html(alreadyPage(slot.name), 409), deviceId);
  }

  try {
    await env.DB.prepare("INSERT INTO scores (code, score, comment, device_id) VALUES (?, ?, ?, ?)").bind(
        slot.code,
        score,
        comment,
        deviceId,
      ).run();
  } catch (err) {
    const message = String(err?.message || err);
    if (/UNIQUE|constraint/i.test(message)) {
      return withDeviceCookie(html(alreadyPage(slot.name), 409), deviceId);
    }
    throw err;
  }

  return withDeviceCookie(html(donePage(slot.name)), deviceId);
}
