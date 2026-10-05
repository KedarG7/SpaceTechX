import express from "express";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";
import { api } from "./routes/index.js";
import { initDatabase } from "./database/geoStore.js";

const app = express();
const PORT = process.env.PORT || 8787;

app.use(cors());
app.use(compression());
app.use(morgan("dev"));
app.use(express.json({ limit: "2mb" }));
app.use("/api", api);

app.get("/", (_req, res) => {
  res.json({
    name: "NDRF Disaster Intelligence API",
    docs: "/api/health",
  });
});

await initDatabase();

app.listen(PORT, () => {
  console.log(`NDRF API listening on http://localhost:${PORT}`);
});
