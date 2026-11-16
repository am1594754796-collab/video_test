import { qrSvg } from "./_lib/qr.js";
import { publicBase, securityHeaders } from "./_lib/http.js";

export async function onRequestGet(context) {
  const url = `${publicBase(context.request)}/s`;
  const svg = qrSvg(url);
  return new Response(svg, {
    headers: {
      ...securityHeaders(),
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
