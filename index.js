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

// ── CORS ───────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.removeHeader("X-Frame-Options");
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
