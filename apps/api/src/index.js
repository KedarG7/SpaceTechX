import express from "express";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";
import { api } from "./routes/index.js";
import { authRouter } from "./routes/auth.js";
import { requireAuth } from "./middleware/requireAuth.js";
import { verifySameOrigin } from "./middleware/requestSecurity.js";
import { authConfiguration } from "./services/authService.js";
import { initDatabase } from "./database/geoStore.js";

const app = express();
const configuredPort = Number(process.env.API_PORT || process.env.PORT || 8787);
if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65535) {
  throw new Error("API_PORT must be an integer from 1 to 65535");
}
const PORT = configuredPort;
const HOST = process.env.HOST || "127.0.0.1";
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 5) {
  throw new Error("TRUST_PROXY_HOPS must be an integer from 0 to 5");
}
app.set("trust proxy", trustProxyHops);

const allowedOrigin = authConfiguration().clientUrl;
app.use(cors({
  origin(origin, callback) {
    if (!origin || origin === allowedOrigin) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
}));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy", "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; object-src 'none'");
  if (process.env.NODE_ENV === "production" && req.secure) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});
app.use(compression());
app.use(morgan("dev"));
app.use(express.json({ limit: "2mb" }));
app.use("/api/auth", authRouter);
app.use("/api", verifySameOrigin, requireAuth, api);

app.get("/", (_req, res) => {
  res.json({
    name: "NDRF Disaster Intelligence API",
    docs: "/api/health",
  });
});

app.use((_req, res) => res.status(404).json({ error: "Not found." }));
app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({ error: "Malformed JSON request." });
  }
  console.error("Unhandled API request error", error);
  return res.status(500).json({ error: "Internal server error." });
});

await initDatabase();

const server = app.listen(PORT, HOST, () => {
  console.log(`NDRF API listening on http://${HOST}:${PORT}`);
});
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`NDRF API could not start: ${HOST}:${PORT} is already in use. Set API_PORT to another available port.`);
    process.exitCode = 1;
    return;
  }
  throw error;
});
