import { Router } from "express";
import { recordAudit } from "../services/auditService.js";
import { verifySameOrigin } from "../middleware/requestSecurity.js";
import {
  authConfiguration,
  clearCookieHeader,
  cookieHeader,
  createSession,
  credentialsAreValid,
  readSession,
  revokeSession,
  sessionTokenFromRequest,
} from "../services/authService.js";

export const authRouter = Router();
authRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store, private");
  next();
});

const attemptsByIp = new Map();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requestIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function auditAuthEvent(req, action, user = "unknown") {
  recordAudit({
    action,
    user,
    detail: {
      ip: requestIp(req),
      userAgent: req.get("user-agent") || null,
    },
  });
}

function isRateLimited(ip) {
  const now = Date.now();
  const attempt = attemptsByIp.get(ip);
  if (!attempt || now - attempt.startedAt >= ATTEMPT_WINDOW_MS) {
    attemptsByIp.delete(ip);
    return false;
  }
  return attempt.count >= MAX_FAILED_ATTEMPTS;
}

function recordFailedAttempt(ip) {
  const now = Date.now();
  const previous = attemptsByIp.get(ip);
  const attempt = !previous || now - previous.startedAt >= ATTEMPT_WINDOW_MS
    ? { count: 1, startedAt: now }
    : { ...previous, count: previous.count + 1 };
  attemptsByIp.set(ip, attempt);
  if (attemptsByIp.size > 5000) {
    for (const [key, value] of attemptsByIp) {
      if (now - value.startedAt >= ATTEMPT_WINDOW_MS) attemptsByIp.delete(key);
      if (attemptsByIp.size <= 4000) break;
    }
  }
}

function clearFailedAttempts(ip) {
  attemptsByIp.delete(ip);
}

authRouter.post("/login", verifySameOrigin, (req, res) => {
  const ip = requestIp(req);
  if (isRateLimited(ip)) {
    const attempt = attemptsByIp.get(ip);
    const secondsRemaining = Math.max(1, Math.ceil((attempt.startedAt + ATTEMPT_WINDOW_MS - Date.now()) / 1000));
    res.setHeader("Retry-After", String(secondsRemaining));
    auditAuthEvent(req, "LOGIN_FAILURE", "unknown");
    return res.status(429).json({ error: "Too many sign-in attempts. Please try again later." });
  }

  const body = req.body;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (
    !body || typeof body !== "object" || Array.isArray(body) ||
    !email || email.length > 254 || !EMAIL_PATTERN.test(email) ||
    !password || password.length > 4096 ||
    Object.keys(body).some((key) => !["email", "password"].includes(key))
  ) {
    recordFailedAttempt(ip);
    auditAuthEvent(req, "LOGIN_FAILURE", email.toLowerCase() || "unknown");
    return res.status(400).json({ error: "Please enter a valid email and password." });
  }

  const config = authConfiguration();
  if (!config.configured) {
    return res.status(503).json({ error: "Authentication service unavailable." });
  }
  if (!credentialsAreValid(email, password)) {
    recordFailedAttempt(ip);
    auditAuthEvent(req, "LOGIN_FAILURE", email.toLowerCase());
    return res.status(401).json({ error: "Invalid credentials." });
  }

  clearFailedAttempts(ip);
  const session = createSession(config.email);
  res.setHeader("Set-Cookie", cookieHeader(session.token, session.expiresInSeconds));
  auditAuthEvent(req, "LOGIN_SUCCESS", config.email);
  return res.json({ authenticated: true, user: { email: config.email } });
});

authRouter.get("/me", (req, res) => {
  const token = sessionTokenFromRequest(req);
  const session = readSession(token);
  if (session.status === "unavailable") {
    return res.status(503).json({ authenticated: false, error: "Authentication service unavailable." });
  }
  if (session.status === "authenticated") {
    return res.json({ authenticated: true, user: session.user });
  }
  if (session.status === "expired") {
    res.setHeader("Set-Cookie", clearCookieHeader());
    auditAuthEvent(req, "SESSION_EXPIRED", session.user?.email || "unknown");
    return res.status(401).json({
      authenticated: false,
      sessionExpired: true,
      error: "Your secure session has expired. Please authenticate again.",
    });
  }
  if (token) res.setHeader("Set-Cookie", clearCookieHeader());
  return res.json({ authenticated: false });
});

authRouter.post("/logout", verifySameOrigin, (req, res) => {
  const token = sessionTokenFromRequest(req);
  const user = revokeSession(token);
  if (user?.email) auditAuthEvent(req, "LOGOUT", user.email);
  res.setHeader("Set-Cookie", clearCookieHeader());
  return res.json({ authenticated: false });
});
