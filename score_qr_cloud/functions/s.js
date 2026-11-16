import { alreadyScored, ensureSchema, listSlots, scoredCodesForDevice } from "./_lib/db.js";
import { getDeviceId, html, json, withDeviceCookie } from "./_lib/http.js";
import { alreadyPage, allDonePage, ratePage } from "./_lib/pages.js";
import { parseSubmission } from "./_lib/validate.js";

function nextOpenSlot(slots, scoredCodes) {
  return slots.find((slot) => !scoredCodes.has(slot.code)) ?? null;
}

function wantsJson(request, form) {
  const accept = request.headers.get("Accept") || "";
  return accept.includes("application/json") || form?.get("ajax") === "1";
}

function scoredSlotNumbers(slots, scoredCodes) {
  return slots.filter((slot) => scoredCodes.has(slot.code)).map((slot) => slot.slot);
}

function rateResponse({ slots, scoredCodes, current, error = null, notice = null, status = 200 }, deviceId) {
  return withDeviceCookie(
    html(
      ratePage({
        slots,
        scoredSlots: scoredSlotNumbers(slots, scoredCodes),
        currentSlot: current,
        selectedScore: "",
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
  const slots = await listSlots(env.DB);
  const scoredCodes = await scoredCodesForDevice(env.DB, deviceId);
  const lockedSlot = context.params?.slot ? slots.find((row) => String(row.slot) === String(context.params.slot)) : null;

  if (lockedSlot) {
    if (await alreadyScored(env.DB, deviceId, lockedSlot.code)) {
      if (wantsJson(request)) {
        return jsonResult({ error: `您已给 ${lockedSlot.name} 提交过评分`, done: true }, 409, deviceId);
      }
      return withDeviceCookie(html(alreadyPage(lockedSlot.name), request.method === "POST" ? 409 : 200), deviceId);
    }
    if (request.method === "GET") {
      return rateResponse({ slots: [lockedSlot], scoredCodes, current: lockedSlot }, deviceId);
    }
  }

  if (request.method === "GET") {
    const current = lockedSlot || nextOpenSlot(slots, scoredCodes);
    if (!current) return withDeviceCookie(html(allDonePage()), deviceId);
    return rateResponse({ slots, scoredCodes, current }, deviceId);
  }

  if (request.method !== "POST") {
    return html("Method Not Allowed", 405);
  }

  const form = await request.formData();
  const asJson = wantsJson(request, form);
  const current = lockedSlot || nextOpenSlot(slots, scoredCodes);
  if (!current) {
    if (asJson) return jsonResult({ done: true, notice: "六人已全部评完" }, 200, deviceId);
    return withDeviceCookie(html(allDonePage()), deviceId);
  }

  const selectedSlot = String(form.get("slot") ?? "");
  let { score, comment, error } = parseSubmission(form);
  if (selectedSlot !== String(current.slot)) {
    error = `请按顺序给 ${current.name} 打分。`;
  }

  if (error) {
    if (asJson) return jsonResult({ error, nextSlot: current.slot, scoredSlots: scoredSlotNumbers(slots, scoredCodes) }, 400, deviceId);
    return rateResponse(
      {
        slots: lockedSlot ? [lockedSlot] : slots,
        scoredCodes,
        current,
        error,
        status: 400,
      },
      deviceId,
    );
  }

  if (await alreadyScored(env.DB, deviceId, current.code)) {
    scoredCodes.add(current.code);
    const next = lockedSlot ? null : nextOpenSlot(slots, scoredCodes);
    if (!next) {
      if (asJson) return jsonResult({ done: true, scoredSlot: current.slot }, 200, deviceId);
      return withDeviceCookie(html(allDonePage()), deviceId);
    }
    if (asJson) {
      return jsonResult(
        {
          ok: true,
          scoredSlot: current.slot,
          nextSlot: next.slot,
          scoredSlots: scoredSlotNumbers(slots, scoredCodes),
          notice: `${current.name} 已评过，请继续给 ${next.name}`,
        },
        200,
        deviceId,
      );
    }
    return rateResponse(
      {
        slots,
        scoredCodes,
        current: next,
        notice: `${current.name} 已评过，请继续下一位`,
        status: 409,
      },
      deviceId,
    );
  }

  try {
    await env.DB.prepare("INSERT INTO scores (code, score, comment, device_id) VALUES (?, ?, ?, ?)")
      .bind(current.code, score, comment, deviceId)
      .run();
  } catch (err) {
    const message = String(err?.message || err);
    if (!/UNIQUE|constraint/i.test(message)) throw err;
    scoredCodes.add(current.code);
  }

  scoredCodes.add(current.code);

  if (lockedSlot) {
    if (asJson) return jsonResult({ done: true, scoredSlot: current.slot, notice: `已给 ${current.name} 打分` }, 200, deviceId);
    return withDeviceCookie(html(allDonePage(current.name)), deviceId);
  }

  const next = nextOpenSlot(slots, scoredCodes);
  if (!next) {
    if (asJson) return jsonResult({ done: true, scoredSlot: current.slot }, 200, deviceId);
    return withDeviceCookie(html(allDonePage()), deviceId);
  }

  const notice = `已给 ${current.name} 打分，请继续给 ${next.name}`;
  if (asJson) {
    return jsonResult(
      {
        ok: true,
        scoredSlot: current.slot,
        nextSlot: next.slot,
        scoredSlots: scoredSlotNumbers(slots, scoredCodes),
        notice,
      },
      200,
      deviceId,
    );
  }

  return rateResponse({ slots, scoredCodes, current: next, notice }, deviceId);
}
