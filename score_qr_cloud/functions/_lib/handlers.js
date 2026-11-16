import { boardPaths, getBoard } from "./boards.js";
import {
  alreadyScored,
  clearBoardScores,
  ensureSchema,
  getRateTitle,
  insertScore,
  listSlots,
  liveRows,
  scoredCodesForDevice,
  setRateTitle,
  updateSlotNames,
} from "./db.js";
import { getDeviceId, html, json, publicBase, redirect, securityHeaders, withDeviceCookie } from "./http.js";
import { alreadyPage, allDonePage, livePage, ratePage } from "./pages.js";
import { qrSvg } from "./qr.js";
import { parseNames, parseRateTitle, parseSubmission } from "./validate.js";

function wantsJson(request, form) {
  const accept = request.headers.get("Accept") || "";
  return accept.includes("application/json") || form?.get("ajax") === "1";
}

function scoredSlotNumbers(slots, scoredCodes) {
  return slots.filter((slot) => scoredCodes.has(slot.code)).map((slot) => slot.slot);
}

function jsonResult(data, status, deviceId) {
  return withDeviceCookie(json(data, status), deviceId);
}

async function rateResponse({ env, board, slots, scoredCodes, error = null, notice = null, status = 200 }, deviceId) {
  const title = await getRateTitle(env.DB, board.id);
  return withDeviceCookie(
    html(
      ratePage({
        slots,
        scoredSlots: scoredSlotNumbers(slots, scoredCodes),
        title,
        error,
        notice,
      }),
      status,
    ),
    deviceId,
  );
}

export function createAdminGet(boardId) {
  return async function onRequestGet(context) {
    const { env, request } = context;
    await ensureSchema(env.DB);
    const board = getBoard(boardId);
    const url = new URL(request.url);
    const slots = await listSlots(env.DB, board.id);
    const rateTitle = await getRateTitle(env.DB, board.id);
    return html(
      livePage({
        boardId: board.id,
        cleared: url.searchParams.get("cleared") === "1",
        saved: url.searchParams.get("saved") === "1",
        slots,
        rateTitle,
        error: null,
      }),
    );
  };
}

export function createCodesPost(boardId) {
  return async function onRequestPost(context) {
    const { request, env } = context;
    await ensureSchema(env.DB);
    const board = getBoard(boardId);
    const paths = boardPaths(board);
    const form = await request.formData();
    const raw = Array.from({ length: board.slotCount }, (_, i) => form.get(`name${i + 1}`));
    const parsedNames = parseNames(raw, board.slotCount);
    const parsedTitle = parseRateTitle(form.get("rate_title"));
    const slots = await listSlots(env.DB, board.id);
    const rateTitle = await getRateTitle(env.DB, board.id);
    const error = parsedNames.error || parsedTitle.error;

    if (error) {
      return html(
        livePage({
          boardId: board.id,
          cleared: false,
          slots,
          rateTitle: parsedTitle.title || rateTitle,
          error,
        }),
        400,
      );
    }

    await updateSlotNames(env.DB, parsedNames.names, board.id);
    await setRateTitle(env.DB, parsedTitle.title, board.id);
    return redirect(`${paths.admin === "/" ? "/" : paths.admin}?saved=1`);
  };
}

export function createClearPost(boardId) {
  return async function onRequestPost(context) {
    const { env } = context;
    await ensureSchema(env.DB);
    const board = getBoard(boardId);
    const paths = boardPaths(board);
    await clearBoardScores(env.DB, board.id);
    return redirect(`${paths.admin === "/" ? "/" : paths.admin}?cleared=1`);
  };
}

export function createQrGet(boardId) {
  return async function onRequestGet(context) {
    const board = getBoard(boardId);
    const paths = boardPaths(board);
    const url = `${publicBase(context.request)}${paths.rate}`;
    const svg = qrSvg(url);
    return new Response(svg, {
      headers: {
        ...securityHeaders(),
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  };
}

export function createLiveScoresGet(boardId) {
  return async function onRequestGet(context) {
    await ensureSchema(context.env.DB);
    const rows = await liveRows(context.env.DB, boardId);
    return json({ rows }, 200, { "Cache-Control": "no-store" });
  };
}

export function createRateHandler(boardId) {
  return async function onRequest(context) {
    const { request, env } = context;
    await ensureSchema(env.DB);
    const board = getBoard(boardId);
    const deviceId = getDeviceId(request);
    const allSlots = await listSlots(env.DB, board.id);
    const scoredCodes = await scoredCodesForDevice(env.DB, deviceId, board.id);
    const lockedSlot = context.params?.slot ? allSlots.find((row) => String(row.slot) === String(context.params.slot)) : null;
    const slots = lockedSlot ? [lockedSlot] : allSlots;

    if (request.method === "GET") {
      if (lockedSlot && scoredCodes.has(lockedSlot.code)) {
        return withDeviceCookie(html(alreadyPage(lockedSlot.name)), deviceId);
      }
      if (!lockedSlot && scoredSlotNumbers(allSlots, scoredCodes).length >= allSlots.length) {
        return withDeviceCookie(html(allDonePage(null, board.slotCount)), deviceId);
      }
      return rateResponse({ env, board, slots, scoredCodes }, deviceId);
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
      return rateResponse({ env, board, slots, scoredCodes, error, status: 400 }, deviceId);
    }

    if (await alreadyScored(env.DB, deviceId, slot.code, board.id)) {
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
      await insertScore(env.DB, {
        boardId: board.id,
        code: slot.code,
        score,
        comment,
        deviceId,
      });
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

    if (lockedSlot) return withDeviceCookie(html(allDonePage(slot.name, board.slotCount)), deviceId);
    if (done) return withDeviceCookie(html(allDonePage(null, board.slotCount)), deviceId);
    return rateResponse({ env, board, slots, scoredCodes, notice }, deviceId);
  };
}
