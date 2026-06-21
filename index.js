import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import connectDB from "./config/database.js";
import fileUploadRoutes from "./routes/FileUpload.js";
import folderRoutes     from "./routes/folder.js";

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

connectDB();

app.use(express.json());

// ── Security headers & CORS ─────────────────────────────────────────────────
// CORS is intentionally restrictive: the frontend is served same-origin via
// express.static below, so the API needs zero cross-origin access for normal
// operation. Set ALLOWED_ORIGIN in .env only if you split frontend/backend
// across different domains in the future — until then, this stays locked down.
app.use((req, res, next) => {
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }
  // Clickjacking protection — this app has no legitimate reason to ever be framed.
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'none'; object-src 'none'");
  // Stops browsers from "sniffing" a file's real content and overriding the
  // Content-Type we declare — relevant since uploaded-file MIME types
  // ultimately come from the client at upload time.
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── Static frontend ────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));

// ── API Routes ─────────────────────────────────────────────────────────────
app.use("/api/files",   fileUploadRoutes);
app.use("/api/folders", folderRoutes);

// ── SPA fallback ───────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
