import express from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import {
  uploadFile,
  getAllFiles,
  getSingleFile,
  getFileByToken,
  setVisibility,
  renameFile,
  previewFile,
  downloadFile,
  deleteFile,
} from "../controllers/fileUpload.js";

const router = express.Router();

// Token lookup is the one endpoint where brute-forcing matters most — a token
// IS the access control here, so this limiter is the main defense against
// scripted guessing. 64-bit tokens make brute force computationally
// infeasible already, but rate limiting closes the gap regardless.
const tokenLookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many token attempts — please wait a moment and try again" },
});

// Loose cap on uploads to blunt basic storage/bandwidth abuse, well above
// anything a real person would trigger by hand.
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many uploads in a short time — please slow down" },
});

const ALLOWED = [
  "image/jpeg","image/png","image/gif","image/webp",
  "video/mp4","video/webm","video/ogg","video/quicktime","video/x-msvideo",
  "application/pdf",
  "application/zip","application/x-zip-compressed",
];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // flat 50MB cap, all file types
  fileFilter: (req, file, cb) =>
    ALLOWED.includes(file.mimetype) ? cb(null, true) : cb(new Error(`"${file.mimetype}" is not supported`)),
});

const handleUpload = (req, res, next) =>
  upload.single("file")(req, res, (err) => {
    if (err instanceof multer.MulterError) return res.status(400).json({ message: `Upload error: ${err.message}` });
    if (err) return res.status(400).json({ message: err.message });
    next();
  });

// ── File routes ────────────────────────────────────────────────────────────

router.post("/upload",            uploadLimiter, handleUpload, uploadFile);
router.get("/",                   getAllFiles);

// Token lookup — must come before /:id routes (specific before generic)
router.get("/token/:token",       tokenLookupLimiter, getFileByToken);

router.get("/:id/preview",        previewFile);
router.get("/:id/download",       downloadFile);
router.get("/:id",                getSingleFile);

// Visibility toggle — must come before /:id (PATCH) to avoid swallowing it
router.patch("/:id/visibility",   setVisibility);
router.patch("/:id",              renameFile);

router.delete("/:id",             deleteFile);

export default router;
