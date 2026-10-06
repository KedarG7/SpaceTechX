import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const sessions = new Map();
export const AUTH_COOKIE_NAME = "ndrf_session";

function durationSeconds(value) {
  const match = String(value || "8h").trim().match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const multiplier = { s: 1, m: 60, h: 3600, d: 86400 }[match[2].toLowerCase()];
  const seconds = amount * multiplier;
  return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 86400 ? seconds : null;
}

export function authConfiguration() {
  const email = process.env.NDRF_ADMIN_EMAIL?.trim() || "";
  const password = process.env.NDRF_ADMIN_PASSWORD || "";
  const jwtSecret = process.env.JWT_SECRET || "";
  const sessionSecret = process.env.SESSION_SECRET || "";
  const expiresIn = process.env.JWT_EXPIRES_IN || "8h";
  const clientUrl = process.env.CLIENT_URL?.trim() ||
    (process.env.NODE_ENV === "production" ? "" : "http://localhost:5173");
  const expiresInSeconds = durationSeconds(expiresIn);
  let validClientUrl = false;
  try {
    const url = new URL(clientUrl);
    validClientUrl = ["http:", "https:"].includes(url.protocol);
  } catch {
    validClientUrl = false;
  }
  const configured = Boolean(
    email && password && jwtSecret.length >= 32 && sessionSecret.length >= 32 &&
    expiresInSeconds && (process.env.NODE_ENV !== "production" || validClientUrl)
  );
  return {
    configured,
    email,
    password,
    jwtSecret,
    sessionSecret,
    expiresInSeconds: expiresInSeconds || 8 * 60 * 60,
    clientUrl,
    production: process.env.NODE_ENV === "production",
  };
}

function constantTimeStringEqual(candidate, expected, key) {
  const candidateDigest = createHmac("sha256", key).update(candidate).digest();
  const expectedDigest = createHmac("sha256", key).update(expected).digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}

export function credentialsAreValid(email, password) {
  const config = authConfiguration();
  if (!config.configured) return false;
  const normalizedEmail = email.trim().toLowerCase();
  return constantTimeStringEqual(normalizedEmail, config.email.toLowerCase(), config.sessionSecret) &&
    constantTimeStringEqual(password, config.password, config.sessionSecret);
}

function encodeJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sessionKey(jti, secret) {
  return createHmac("sha256", secret).update(jti).digest("hex");
}

export function createSession(email) {
  const config = authConfiguration();
  if (!config.configured) throw new Error("Authentication service is not configured");
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    sub: email,
    email,
    iat: issuedAt,
    exp: issuedAt + config.expiresInSeconds,
    jti: randomBytes(32).toString("base64url"),
  };
  const unsigned = `${encodeJson({ alg: "HS256", typ: "JWT" })}.${encodeJson(payload)}`;
  const signature = createHmac("sha256", config.jwtSecret).update(unsigned).digest("base64url");
  const token = `${unsigned}.${signature}`;
  sessions.set(sessionKey(payload.jti, config.sessionSecret), {
    email,
    expiresAt: payload.exp * 1000,
  });
  return { token, expiresInSeconds: config.expiresInSeconds };
}

function decodePart(part) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

export function readSession(token) {
  if (!token) return { status: "unauthenticated", user: null };
  const config = authConfiguration();
  if (!config.configured) return { status: "unavailable", user: null };
  const parts = token.split(".");
  if (parts.length !== 3) return { status: "unauthenticated", user: null };

  try {
    const unsigned = `${parts[0]}.${parts[1]}`;
    const expectedSignature = createHmac("sha256", config.jwtSecret).update(unsigned).digest();
    const providedSignature = Buffer.from(parts[2], "base64url");
    if (
      providedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(providedSignature, expectedSignature)
    ) return { status: "unauthenticated", user: null };

    const header = decodePart(parts[0]);
    const payload = decodePart(parts[1]);
    if (
      header?.alg !== "HS256" ||
      typeof payload?.email !== "string" ||
      payload.sub !== payload.email ||
      typeof payload.jti !== "string" ||
      !Number.isInteger(payload.exp)
    ) return { status: "unauthenticated", user: null };

    const key = sessionKey(payload.jti, config.sessionSecret);
    const session = sessions.get(key);
    if (payload.exp * 1000 <= Date.now() || session?.expiresAt <= Date.now()) {
      sessions.delete(key);
      return { status: "expired", user: { email: payload.email } };
    }
    if (!session || session.email !== payload.email) {
      return { status: "unauthenticated", user: null };
    }
    return { status: "authenticated", user: { email: session.email } };
  } catch {
    return { status: "unauthenticated", user: null };
  }
}

export function revokeSession(token) {
  const config = authConfiguration();
  const session = readSession(token);
  if (token && config.configured) {
    const parts = token.split(".");
    if (parts.length === 3) {
      try {
        const header = decodePart(parts[0]);
        const payload = decodePart(parts[1]);
        const unsigned = `${parts[0]}.${parts[1]}`;
        const expected = createHmac("sha256", config.jwtSecret).update(unsigned).digest();
        const provided = Buffer.from(parts[2], "base64url");
        if (header?.alg === "HS256" && provided.length === expected.length && timingSafeEqual(provided, expected)) {
          sessions.delete(sessionKey(payload.jti, config.sessionSecret));
        }
      } catch {
        // Invalid or expired tokens are already unauthenticated.
      }
    }
  }
  return session.user;
}

export function cookieHeader(token, maxAge) {
  const secure = authConfiguration().production ? "; Secure" : "";
  return `${AUTH_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function clearCookieHeader() {
  const secure = authConfiguration().production ? "; Secure" : "";
  return `${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export function sessionTokenFromRequest(req) {
  const header = req.headers.cookie || "";
  const prefix = `${AUTH_COOKIE_NAME}=`;
  for (const value of header.split(";")) {
    const cookie = value.trim();
    if (cookie.startsWith(prefix)) return cookie.slice(prefix.length);
  }
  return null;
}
