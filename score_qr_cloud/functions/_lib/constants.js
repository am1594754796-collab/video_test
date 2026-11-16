export const SLOT_COUNT = 6;
export const SCORE_MIN = 0;
export const SCORE_MAX = 100;
export const COMMENT_MAX = 200;
export const DEVICE_COOKIE = "score_qr_device";
export const DEVICE_RE = /^[A-Za-z0-9_-]{32,64}$/;
export const DEVICE_COOKIE_AGE = 365 * 24 * 60 * 60;
export const CODE_RE = /^[\p{L}\p{N}_-]{1,32}$/u;
