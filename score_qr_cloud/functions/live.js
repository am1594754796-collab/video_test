import { redirect } from "./_lib/http.js";

/** Legacy /live → home board. */
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const qs = url.searchParams.toString();
  return redirect(qs ? `/?${qs}` : "/");
}
