import { recordAudit } from "../services/auditService.js";
import {
  AUTH_COOKIE_NAME,
  clearCookieHeader,
  readSession,
  sessionTokenFromRequest,
} from "../services/authService.js";

function auditSessionExpiry(req, email) {
  recordAudit({
    action: "SESSION_EXPIRED",
    user: email || "unknown",
    detail: {
      ip: req.ip,
      userAgent: req.get("user-agent") || null,
    },
  });
}

export function requireAuth(req, res, next) {
  const token = sessionTokenFromRequest(req);
  const session = readSession(token);
  if (session.status === "authenticated") {
    req.operatorEmail = session.user.email;
    return next();
  }
  if (session.status === "expired") {
    res.setHeader("Set-Cookie", clearCookieHeader());
    auditSessionExpiry(req, session.user?.email);
    return res.status(401).json({
      error: "Your secure session has expired. Please authenticate again.",
      sessionExpired: true,
    });
  }
  if (session.status === "unavailable") {
    return res.status(503).json({ error: "Authentication service unavailable." });
  }
  res.setHeader("WWW-Authenticate", `Cookie realm="${AUTH_COOKIE_NAME}"`);
  return res.status(401).json({ error: "Authentication required." });
}
