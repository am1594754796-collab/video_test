import { alreadyScored, ensureSchema, listSlots, scoredCodesForDevice } from "./_lib/db.js";
import { getDeviceId, html, json, withDeviceCookie } from "./_lib/http.js";
import { alreadyPage, allDonePage, ratePage } from "./_lib/pages.js";
import { parseSubmission } from "./_lib/validate.js";

function wantsJson(request, form) {
  const accept = request.headers.get("Accept") || "";
  return accept.includes("application/json") || form?.get("ajax") === "1";
}

function scoredSlotNumbers(slots, scoredCodes) {
  return slots.filter((slot) => scoredCodes.has(slot.code)).map((slot) => slot.slot);
}

function rateResponse({ slots, scoredCodes, error = null, notice = null, status = 200 }, deviceId) {
  return withDeviceCookie(
    html(
      ratePage({
        slots,
        scoredSlots: scoredSlotNumbers(slots, scoredCodes),
        error,
        notice,
      }),
      status,
    ),
    deviceId,
  );
}

function jsonResult(data, status, deviceId) {
  return withDeviceCookie(json(data, status), deviceId);
}

export async function onRequest(context) {
  const { request, env } = context;
  await ensureSchema(env.DB);
  const deviceId = getDeviceId(request);
  const allSlots = await listSlots(env.DB);
  const scoredCodes = await scoredCodesForDevice(env.DB, deviceId);
  const lockedSlot = context.params?.slot ? allSlots.find((row) => String(row.slot) === String(context.params.slot)) : null;
  const slots = lockedSlot ? [lockedSlot] : allSlots;

  if (request.method === "GET") {
    if (lockedSlot && scoredCodes.has(lockedSlot.code)) {
      return withDeviceCookie(html(alreadyPage(lockedSlot.name)), deviceId);
    }
    if (!lockedSlot && scoredSlotNumbers(allSlots, scoredCodes).length >= allSlots.length) {
      return withDeviceCookie(html(allDonePage()), deviceId);
    }
    return rateResponse({ slots, scoredCodes }, deviceId);
  }

  if (request.method !== "POST") {
    return html("Method Not Allowed", 405);
  }

  const form = await request.formData();
  const asJson = wantsJson(request, form);
  const selectedSlot = String(form.get("slot") ?? "");
  const slot = slots.find((row) => String(row.slot) === selectedSlot);
  let { score, comment, error } = parseSubmission(form);
  if (!slot) error = "请选择要评分的人。";

  if (error) {
    if (asJson) {
      return jsonResult({ error, scoredSlots: scoredSlotNumbers(allSlots, scoredCodes) }, 400, deviceId);
    }
    return rateResponse({ slots, scoredCodes, error, status: 400 }, deviceId);
  }

  if (await alreadyScored(env.DB, deviceId, slot.code)) {
    scoredCodes.add(slot.code);
    if (asJson) {
      return jsonResult(
        {
          error: `您已给 ${slot.name} 提交过评分`,
          scoredSlot: slot.slot,
          scoredSlots: scoredSlotNumbers(allSlots, scoredCodes),
          already: true,
        },
        409,
        deviceId,
      );
    }
    return withDeviceCookie(html(alreadyPage(slot.name), 409), deviceId);
  }

  try {
    await env.DB.prepare("INSERT INTO scores (code, score, comment, device_id) VALUES (?, ?, ?, ?)")
      .bind(slot.code, score, comment, deviceId)
      .run();
  } catch (err) {
    const message = String(err?.message || err);
    if (/UNIQUE|constraint/i.test(message)) {
      scoredCodes.add(slot.code);
      if (asJson) {
        return jsonResult(
          {
            error: `您已给 ${slot.name} 提交过评分`,
            scoredSlot: slot.slot,
            scoredSlots: scoredSlotNumbers(allSlots, scoredCodes),
            already: true,
          },
          409,
          deviceId,
        );
      }
      return withDeviceCookie(html(alreadyPage(slot.name), 409), deviceId);
    }
    throw err;
  }

  scoredCodes.add(slot.code);
  const scoredSlots = scoredSlotNumbers(allSlots, scoredCodes);
  const done = !lockedSlot && scoredSlots.length >= allSlots.length;
  const notice = `已给 ${slot.name} 打分`;

  if (asJson) {
    return jsonResult({ ok: true, scoredSlot: slot.slot, scoredSlots, done, notice }, 200, deviceId);
  }

  if (lockedSlot) return withDeviceCookie(html(allDonePage(slot.name)), deviceId);
  if (done) return withDeviceCookie(html(allDonePage()), deviceId);
  return rateResponse({ slots, scoredCodes, notice }, deviceId);
}
