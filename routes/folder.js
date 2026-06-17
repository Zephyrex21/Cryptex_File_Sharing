import express from "express";
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
} from "../controllers/folderController.js";

const router = express.Router();

// ── Folder routes ──────────────────────────────────────────────────────────

router.post("/",                    createFolder);
router.get("/",                     getAllFolders);

// Token lookup — specific before /:id (same rule as file routes)
router.get("/token/:token",         getFolderByToken);

router.get("/:id",                  getFolderById);

// Visibility — specific before /:id (PATCH)
router.patch("/:id/visibility",     setFolderVisibility);
router.patch("/:id",                renameFolder);

router.delete("/:id",               deleteFolder);

// File membership
router.post("/:id/files",           addFileToFolder);
router.delete("/:id/files/:fileId", removeFileFromFolder);

export default router;
