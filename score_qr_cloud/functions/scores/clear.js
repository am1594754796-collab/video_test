import { ensureSchema } from "../_lib/db.js";
import { redirect } from "../_lib/http.js";

export async function onRequestPost(context) {
  const { env } = context;
  await ensureSchema(env.DB);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM scores"),
    env.DB.prepare("DELETE FROM score_voters"),
  ]);
  return redirect("/?cleared=1");
}
