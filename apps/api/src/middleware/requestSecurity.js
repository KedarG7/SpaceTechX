import { authConfiguration } from "../services/authService.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function verifySameOrigin(req, res, next) {
  const origin = req.get("origin");
  const expectedOrigin = authConfiguration().clientUrl;
  if (!origin) {
    if (SAFE_METHODS.has(req.method)) return next();
    return res.status(403).json({ error: "Request origin not allowed." });
  }

  try {
    if (new URL(origin).origin !== new URL(expectedOrigin).origin) {
      return res.status(403).json({ error: "Request origin not allowed." });
    }
  } catch {
    return res.status(403).json({ error: "Request origin not allowed." });
  }
  return next();
}
