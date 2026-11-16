import { ensureSchema, listSlots } from "./_lib/db.js";
import { html } from "./_lib/http.js";
import { livePage } from "./_lib/pages.js";

/** Home page = board: shared QR + live scores + name config + clear. */
export async function onRequestGet(context) {
  const { env, request } = context;
  await ensureSchema(env.DB);
  const url = new URL(request.url);
  const slots = await listSlots(env.DB);
  return html(
    livePage({
      cleared: url.searchParams.get("cleared") === "1",
      saved: url.searchParams.get("saved") === "1",
      slots,
      error: null,
    }),
  );
}
