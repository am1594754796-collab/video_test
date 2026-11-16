import { html } from "./_lib/http.js";
import { qrPage } from "./_lib/pages.js";

export function onRequestGet() {
  return html(qrPage());
}
