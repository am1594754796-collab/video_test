import { DEVICE_COOKIE, DEVICE_COOKIE_AGE, DEVICE_RE } from "./constants.js";

export function securityHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; script-src 'self'",
    "Referrer-Policy": "no-referrer",
    ...extra,
  };
}

export function html(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...securityHeaders(), ...headers },
  });
}

export function json(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: { ...securityHeaders(), ...headers },
  });
}

export function redirect(location, status = 302) {
  return new Response(null, { status, headers: securityHeaders({ Location: location }) });
}

export function getDeviceId(request) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`${DEVICE_COOKIE}=([^;]+)`));
  const value = match ? decodeURIComponent(match[1]) : "";
  if (DEVICE_RE.test(value)) return value;
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function withDeviceCookie(response, deviceId) {
  const secure = true;
  const cookie = `${DEVICE_COOKIE}=${encodeURIComponent(deviceId)}; Path=/; Max-Age=${DEVICE_COOKIE_AGE}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", cookie);
  return new Response(response.body, { status: response.status, headers });
}

export function requireAdmin(request, env, form) {
  const expected = env.SCORE_QR_ADMIN_TOKEN || "";
  if (!expected) {
    return { ok: false, error: "未配置管理口令 SCORE_QR_ADMIN_TOKEN，无法修改。" };
  }
  const provided =
    (form && form.get("admin_token")) ||
    request.headers.get("X-Admin-Token") ||
    "";
  if (provided !== expected) return { ok: false, error: "管理口令不正确。" };
  return { ok: true };
}

export function publicBase(request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}
