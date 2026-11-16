import { createAdminGet } from "./_lib/handlers.js";

/** Exact /case admin board (keeps /case/* routes in functions/case/). */
export const onRequestGet = createAdminGet("case");
