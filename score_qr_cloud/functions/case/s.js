import { createRateHandler } from "../_lib/handlers.js";

export const onRequest = createRateHandler("case");
