import express from "express";
import rateLimit from "express-rate-limit";
import {
  createFolder,
  getAllFolders,
  getFolderById,
  getFolderByToken,
  renameFolder,
  setFolderVisibility,
  deleteFolder,
  addFileToFolder,
  removeFileFromFolder,
  downloadFolderZip,
} from "../controllers/folderController.js";

const router = express.Router();

// Same brute-force defense as the file routes' token lookup.
const tokenLookupLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many token attempts — please wait a moment and try again" },
});

// ── Folder routes ──────────────────────────────────────────────────────────

router.post("/",                    createFolder);
router.get("/",                     getAllFolders);

// Token lookup — specific before /:id (same rule as file routes)
router.get("/token/:token",         tokenLookupLimiter, getFolderByToken);

router.get("/:id",                  getFolderById);
router.get("/:id/zip",               downloadFolderZip);

// Visibility — specific before /:id (PATCH)
router.patch("/:id/visibility",     setFolderVisibility);
router.patch("/:id",                renameFolder);

router.delete("/:id",               deleteFolder);

// File membership
router.post("/:id/files",           addFileToFolder);
router.delete("/:id/files/:fileId", removeFileFromFolder);

export default router;
