import Folder from "../models/Folder.js";
import File   from "../models/File.js";
import { randomUUID } from "crypto";
import { ZipArchive } from "archiver";
import { Readable } from "stream";

const generateToken = () => randomUUID().replace(/-/g, "").slice(0, 16);

// Same defense-in-depth as fileUpload.js's sanitizeOriginalName — strip
// control characters and cap length before anything reaches storage.
const sanitizeFolderName = (name) =>
  String(name).replace(/[\x00-\x1F\x7F]/g, "").slice(0, 255).trim();

// ── Zip Slip protection ──────────────────────────────────────────────────────
// originalName is client-supplied. A name like "../../evil.sh" used as a raw
// zip entry path could escape the extraction folder on whoever downloads and
// unzips it. Strip any directory components and traversal sequences, keeping
// only a flat, safe basename.
const sanitizeZipEntryName = (name) => {
  // Take just the last path segment, stripping any / or \ separators —
  // discards "../" and any other directory traversal entirely.
  const base = String(name).split(/[\\/]/).pop() || "file";
  // Belt-and-suspenders: also strip any leftover leading dots/traversal chars.
  return base.replace(/^\.+/, "").trim() || "file";
};

// ── CREATE ─────────────────────────────────────────────────────────────────
export const createFolder = async (req, res) => {
  try {
    const { name, visibility } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ message: "Folder name is required" });
    }

    const folder = await Folder.create({
      name:        sanitizeFolderName(name),
      visibility:  visibility || "public",
      shareToken:  generateToken(),
    });

    res.status(201).json({ message: "Folder created!", folder });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

// ── GET ALL ────────────────────────────────────────────────────────────────
// Returns folder metadata only — no file population (lightweight list)
// fileCount virtual is included via toJSON: { virtuals: true } on schema
export const getAllFolders = async (req, res) => {
  try {
    // Only return public folders — private folders are hidden.
    // They are only accessible via their shareToken through GET /token/:token.
    const folders = await Folder.find({ visibility: { $ne: 'private' } }).sort({ createdAt: -1 });

    // One-time migration: assign tokens to any legacy folders that don't have one.
    const needsToken = folders.filter(f => !f.shareToken);
    if (needsToken.length > 0) {
      await Promise.all(needsToken.map(f => { f.shareToken = generateToken(); return f.save(); }));
    }

    // fileCount intentionally reflects the TOTAL number of files assigned to this
    // folder, regardless of each file's own public/private status. A file made
    // private still belongs to the folder structurally — it's just not rendered
    // inside the folder's contents until unlocked via its own token.
    res.status(200).json({ count: folders.length, folders });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

// ── GET ONE BY ID ──────────────────────────────────────────────────────────
// Populates the files array so the frontend can render file cards.
// Private folders require the shareToken as a query param (?token=...)
// so external API access is blocked — the frontend passes it automatically.
export const getFolderById = async (req, res) => {
  try {
    // match filter: individually-private files are NEVER returned through a
    // folder listing, regardless of the folder's own visibility. A private
    // file's only access path is its own token — folder access does not
    // override that.
    const folder = await Folder.findById(req.params.id).populate({
      path: "files",
      match: { visibility: { $ne: "private" } },
    });
    if (!folder) return res.status(404).json({ message: "Folder not found" });

    if (folder.visibility === "private") {
      const provided = req.query.token || req.headers["x-share-token"];
      if (!provided || provided !== folder.shareToken) {
        return res.status(403).json({ message: "Private folder — valid token required" });
      }
    }

    res.status(200).json({ folder });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

// ── GET BY TOKEN ── (shared link access) ──────────────────────────────────
// Also populates files so the recipient can see and download them
export const getFolderByToken = async (req, res) => {
  try {
    // Same rule as getFolderById: an individually-private file is hidden even
    // when the folder itself is being unlocked correctly via its token.
    const folder = await Folder
      .findOne({ shareToken: req.params.token })
      .populate({ path: "files", match: { visibility: { $ne: "private" } } });

    if (!folder) {
      return res.status(404).json({ message: "Invalid token — folder not found" });
    }
    if (folder.tokenExpiresAt && folder.tokenExpiresAt < new Date()) {
      return res.status(410).json({ message: "This token has expired" });
    }

    res.status(200).json({ folder });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

// ── RENAME ─────────────────────────────────────────────────────────────────
export const renameFolder = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) {
      return res.status(400).json({ message: "Name cannot be empty" });
    }

    const folder = await Folder.findByIdAndUpdate(
      req.params.id,
      { name: sanitizeFolderName(name) },
      { new: true }
    );
    if (!folder) return res.status(404).json({ message: "Folder not found" });

    res.status(200).json({ message: "Renamed!", folder });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

// ── SET VISIBILITY ─────────────────────────────────────────────────────────
// Body: { visibility: "public" | "private" }
export const setFolderVisibility = async (req, res) => {
  try {
    const { visibility, expiresIn, regenerateToken } = req.body;
    if (!["public", "private"].includes(visibility)) {
      return res.status(400).json({ message: "visibility must be 'public' or 'private'" });
    }

    const update = { visibility };
    if (visibility === "public") {
      update.tokenExpiresAt = null;
    } else if (expiresIn !== undefined) {
      update.tokenExpiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 60000) : null;
    }
    if (regenerateToken) update.shareToken = generateToken();

    const folder = await Folder.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true }
    );
    if (!folder) return res.status(404).json({ message: "Folder not found" });

    res.status(200).json({ message: `Visibility set to ${visibility}`, folder });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

// ── DELETE ─────────────────────────────────────────────────────────────────
// Deletes the folder only — files are NOT deleted, just unlinked (folderId → null)
export const deleteFolder = async (req, res) => {
  try {
    const folder = await Folder.findById(req.params.id);
    if (!folder) return res.status(404).json({ message: "Folder not found" });

    // Unlink every file that was in this folder
    if (folder.files.length > 0) {
      await File.updateMany(
        { _id: { $in: folder.files } },
        { $set: { folderId: null } }
      );
    }

    await folder.deleteOne();
    res.status(200).json({ message: "Folder deleted! Files are still in your vault." });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

// ── ADD FILE TO FOLDER ─────────────────────────────────────────────────────
// Body: { fileId: "<File _id>" }
// If the file is already in a DIFFERENT folder, it's moved (not duplicated)
export const addFileToFolder = async (req, res) => {
  try {
    const { fileId } = req.body;
    if (!fileId) return res.status(400).json({ message: "fileId is required" });

    const [folder, file] = await Promise.all([
      Folder.findById(req.params.id),
      File.findById(fileId),
    ]);

    if (!folder) return res.status(404).json({ message: "Folder not found" });
    if (!file)   return res.status(404).json({ message: "File not found" });

    // Already in this exact folder?
    if (folder.files.some(f => f.toString() === fileId)) {
      return res.status(400).json({ message: "File is already in this folder" });
    }

    // File was in a different folder — remove it from there first
    if (file.folderId && file.folderId.toString() !== req.params.id) {
      await Folder.findByIdAndUpdate(file.folderId, { $pull: { files: fileId } });
    }

    folder.files.push(fileId);
    file.folderId = folder._id;

    await Promise.all([folder.save(), file.save()]);

    res.status(200).json({ message: "File added to folder!", folder });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

// ── REMOVE FILE FROM FOLDER ────────────────────────────────────────────────
// DELETE /api/folders/:id/files/:fileId
export const removeFileFromFolder = async (req, res) => {
  try {
    const { id, fileId } = req.params;

    const [folder, file] = await Promise.all([
      Folder.findById(id),
      File.findById(fileId),
    ]);

    if (!folder) return res.status(404).json({ message: "Folder not found" });
    if (!file)   return res.status(404).json({ message: "File not found" });

    folder.files = folder.files.filter(f => f.toString() !== fileId);
    file.folderId = null;

    await Promise.all([folder.save(), file.save()]);

    res.status(200).json({ message: "File removed from folder", folder });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

// ── DOWNLOAD AS ZIP ──────────────────────────────────────────────────────────
// Streams every (non-private) file in the folder as a single .zip — no temp
// files written to disk, everything is piped straight through. Same access
// rule as opening the folder: private folders need their token.
export const downloadFolderZip = async (req, res) => {
  try {
    const folder = await Folder.findById(req.params.id).populate({
      path: "files",
      match: { visibility: { $ne: "private" } },
    });
    if (!folder) return res.status(404).json({ message: "Folder not found" });

    if (folder.visibility === "private") {
      const provided = req.query.token || req.headers["x-share-token"];
      if (!provided || provided !== folder.shareToken) {
        return res.status(403).json({ message: "Private folder — valid token required" });
      }
    }
    if (folder.tokenExpiresAt && folder.tokenExpiresAt < new Date() && folder.visibility === "private") {
      return res.status(410).json({ message: "This token has expired" });
    }

    const files = folder.files || [];
    if (!files.length) {
      return res.status(404).json({ message: "No files available to download in this folder" });
    }

    const safeName = (folder.name || "folder").replace(/[^a-z0-9_\-]/gi, "_");
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}.zip"`);

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on("error", (err) => {
      if (!res.headersSent) res.status(500).json({ message: err.message });
      else res.destroy();
    });
    archive.pipe(res);

    // Guard against two files sharing the same name inside the zip
    const usedNames = new Set();
    for (const file of files) {
      const sourceUrl = file.fileUrl || file.cloudinaryUrl;
      if (!sourceUrl) continue;
      try {
        const response = await fetch(sourceUrl);
        if (!response.ok || !response.body) continue;
        let name = sanitizeZipEntryName(file.originalName || "file");
        if (usedNames.has(name)) {
          const dot = name.lastIndexOf(".");
          const ext = dot > 0 ? name.slice(dot) : "";
          const base = dot > 0 ? name.slice(0, dot) : name;
          let n = 2;
          while (usedNames.has(`${base} (${n})${ext}`)) n++;
          name = `${base} (${n})${ext}`;
        }
        usedNames.add(name);
        archive.append(Readable.fromWeb(response.body), { name });
      } catch {
        // Skip a file that fails to fetch rather than aborting the whole zip
      }
    }
    await archive.finalize();
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ message: e.message });
  }
};
