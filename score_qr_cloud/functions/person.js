import { html } from "./_lib/http.js";
import { personPage } from "./_lib/pages.js";
export function onRequestGet() { return html(personPage()); }
