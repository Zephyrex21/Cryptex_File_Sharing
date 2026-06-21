import { randomUUID } from "crypto";
import File from "../models/File.js";
import Folder from "../models/Folder.js";
import supabase from "../config/supabase.js";
import { Readable } from "stream";

const BUCKET = process.env.SUPABASE_BUCKET || "cloudvault-files";

// Shared token generator — 16-char hex string, no extra dependencies
const generateToken = () => randomUUID().replace(/-/g, "").slice(0, 16);

// ── Magic-byte verification ─────────────────────────────────────────────────
// The MIME type multer sees comes straight from the client and is trivially
// spoofable (rename evil.html to photo.jpg, lie about Content-Type). This
// checks the file's actual leading bytes against its claimed type so a
// content/type mismatch is rejected before it ever reaches storage.
// Verified against real sample files of every type in ALLOWED — see test run.
const MAGIC_BYTES = {
  "image/jpeg": [[0xFF, 0xD8, 0xFF]],
  "image/png":  [[0x89, 0x50, 0x4E, 0x47]],
  "image/gif":  [[0x47, 0x49, 0x46, 0x38]],
  "image/webp": "webp",
  "video/webm": [[0x1A, 0x45, 0xDF, 0xA3]],
  "video/ogg":  [[0x4F, 0x67, 0x67, 0x53]],
  "video/x-msvideo": "avi",
  "video/mp4":       "ftyp",
  "video/quicktime": "ftyp",
  "application/pdf": [[0x25, 0x50, 0x44, 0x46]],
  "application/zip":             [[0x50,0x4B,0x03,0x04],[0x50,0x4B,0x05,0x06],[0x50,0x4B,0x07,0x08]],
  "application/x-zip-compressed":[[0x50,0x4B,0x03,0x04],[0x50,0x4B,0x05,0x06],[0x50,0x4B,0x07,0x08]],
};
const bufferStartsWith = (buffer, bytes) => {
  if (buffer.length < bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) if (buffer[i] !== bytes[i]) return false;
  return true;
};
const verifyMagicBytes = (buffer, mimetype) => {
  const sig = MAGIC_BYTES[mimetype];
  if (!sig) return true; // type not in our table — fileFilter already restricts to ALLOWED, so this shouldn't occur
  if (sig === "webp") return bufferStartsWith(buffer, [0x52,0x49,0x46,0x46]) && buffer.slice(8,12).toString("ascii") === "WEBP";
  if (sig === "avi")  return bufferStartsWith(buffer, [0x52,0x49,0x46,0x46]) && buffer.slice(8,12).toString("ascii") === "AVI ";
  if (sig === "ftyp") return buffer.length >= 8 && buffer.slice(4,8).toString("ascii") === "ftyp";
  return sig.some(bytes => bufferStartsWith(buffer, bytes));
};

// Defense in depth: the frontend's esc() already prevents the displayed name
// from causing HTML/script injection, but strip control characters and cap
// length here too, so nothing odd ever lands in storage or logs in the first place.
const sanitizeOriginalName = (name) =>
  String(name).replace(/[\x00-\x1F\x7F]/g, "").slice(0, 255).trim() || "file";

// ── Upload buffer to Supabase Storage ─────────────────────────────────────
const uploadToSupabase = async (buffer, originalname, mimetype) => {
  const dotIdx = originalname.lastIndexOf(".");
  const base = (dotIdx > 0 ? originalname.slice(0, dotIdx) : originalname)
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_.-]/g, "");
  const ext = dotIdx > 0 ? originalname.slice(dotIdx).toLowerCase() : "";
  const filePath = `${base}-${Date.now()}${ext}`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, buffer, { contentType: mimetype, upsert: false });

  if (error) throw new Error(`Supabase upload failed: ${error.message}`);

  const { data: urlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(data.path);

  return { publicUrl: urlData.publicUrl, filePath: data.path };
};

// ── UPLOAD ─────────────────────────────────────────────────────────────────
export const uploadFile = async (req, res) => {
  let filePath = null;

  try {
    if (!req.file) return res.status(400).json({ message: "No file provided" });

    if (!verifyMagicBytes(req.file.buffer, req.file.mimetype)) {
      return res.status(400).json({
        message: `File content doesn't match its declared type (${req.file.mimetype}) — upload rejected`,
      });
    }

    const result = await uploadToSupabase(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );
    filePath = result.filePath;

    // Explicitly generate shareToken — don't rely on schema default,
    // which can silently fail on some Mongoose versions with sparse unique indexes.
    const file = await File.create({
      originalName: sanitizeOriginalName(req.file.originalname),
      fileUrl:      result.publicUrl,
      filePath:     result.filePath,
      fileType:     req.file.mimetype,
      fileSize:     req.file.size,
      storageType:  "supabase",
      shareToken:   generateToken(),
      visibility:   "public",
    });

    res.status(201).json({ message: "Uploaded!", file });
  } catch (e) {
    if (filePath) {
      await supabase.storage.from(BUCKET).remove([filePath]).catch(() => {});
    }
    res.status(500).json({ message: e.message });
  }
};

// ── GET ALL ────────────────────────────────────────────────────────────────
export const getAllFiles = async (req, res) => {
  try {
    // Find IDs of all private folders so we can hide their files from the gallery.
    const privateFolderIds = await Folder.find({ visibility: 'private' }, '_id').lean();
    const privateFolderIdArr = privateFolderIds.map(f => f._id);

    // Build the query:
    //   - exclude individually-private files
    //   - exclude files that belong to a private folder
    const query = { visibility: { $ne: 'private' } };
    if (privateFolderIdArr.length > 0) {
      // $nin correctly handles null/undefined folderId (they're not in the array → included)
      query.folderId = { $nin: privateFolderIdArr };
    }

    const files = await File.find(query).sort({ createdAt: -1 });

    // One-time migration: assign tokens to any legacy docs that don't have one.
    const needsToken = files.filter(f => !f.shareToken);
    if (needsToken.length > 0) {
      await Promise.all(needsToken.map(f => { f.shareToken = generateToken(); return f.save(); }));
    }

    res.status(200).json({ count: files.length, files });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

// ── GET BY TOKEN ── (no auth needed — used for shared links) ───────────────
export const getFileByToken = async (req, res) => {
  try {
    const file = await File.findOne({ shareToken: req.params.token });
    if (!file) return res.status(404).json({ message: "Invalid token — file not found" });
    if (file.tokenExpiresAt && file.tokenExpiresAt < new Date()) {
      return res.status(410).json({ message: "This token has expired" });
    }
    res.status(200).json({ file });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

// ── GET ONE ────────────────────────────────────────────────────────────────
export const getSingleFile = async (req, res) => {
  try {
    const file = await File.findById(req.params.id);
    if (!file) return res.status(404).json({ message: "Not found" });
    res.status(200).json({ file });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

// ── RENAME ─────────────────────────────────────────────────────────────────
export const renameFile = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "Name cannot be empty" });
    const file = await File.findByIdAndUpdate(
      req.params.id,
      { originalName: sanitizeOriginalName(name) },
      { new: true }
    );
    if (!file) return res.status(404).json({ message: "Not found" });
    res.status(200).json({ message: "Renamed!", file });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

// ── SET VISIBILITY ─────────────────────────────────────────────────────────
// Body: { visibility: "public" | "private" }
export const setVisibility = async (req, res) => {
  try {
    const { visibility, expiresIn, regenerateToken } = req.body;
    if (!["public", "private"].includes(visibility)) {
      return res.status(400).json({ message: "visibility must be 'public' or 'private'" });
    }
    const update = { visibility };
    if (visibility === "public") {
      // Expiry only means something while a token is actually gating access.
      update.tokenExpiresAt = null;
    } else if (expiresIn !== undefined) {
      // expiresIn is in minutes. 0/null/falsy → never expires.
      update.tokenExpiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 60000) : null;
    }
    if (regenerateToken) update.shareToken = generateToken();

    const file = await File.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true }
    );
    if (!file) return res.status(404).json({ message: "Not found" });
    res.status(200).json({ message: `Visibility set to ${visibility}`, file });
  } catch (e) { res.status(500).json({ message: e.message }); }
};

// ── Shared streaming helper ────────────────────────────────────────────────
const streamFile = async (req, res, disposition) => {
  const file = await File.findById(req.params.id);
  if (!file) return res.status(404).json({ message: "Not found" });

  const sourceUrl = file.fileUrl || file.cloudinaryUrl;
  if (!sourceUrl) return res.status(404).json({ message: "File URL missing" });

  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Storage returned ${response.status}`);
  if (!response.body) throw new Error("Empty response body from storage");

  const encoded  = encodeURIComponent(file.originalName).replace(/'/g, "%27");
  const fallback = file.originalName.replace(/[^\x20-\x7E]/g, "_");

  res.setHeader("Content-Disposition",
    `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`);
  res.setHeader("Content-Type", file.fileType || "application/octet-stream");

  const cl = response.headers.get("content-length");
  if (cl) res.setHeader("Content-Length", cl);
  res.setHeader("Cache-Control", "public, max-age=3600");

  const stream = Readable.fromWeb(response.body);
  stream.on("error", (err) => {
    if (!res.headersSent) res.status(500).json({ message: err.message });
    else res.destroy();
  });
  stream.pipe(res);
};

// ── PREVIEW ────────────────────────────────────────────────────────────────
export const previewFile = async (req, res) => {
  try {
    await streamFile(req, res, "inline");
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ message: e.message });
  }
};

// ── DOWNLOAD ───────────────────────────────────────────────────────────────
export const downloadFile = async (req, res) => {
  try {
    await streamFile(req, res, "attachment");
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ message: e.message });
  }
};

// ── DELETE ─────────────────────────────────────────────────────────────────
export const deleteFile = async (req, res) => {
  try {
    const file = await File.findById(req.params.id);
    if (!file) return res.status(404).json({ message: "Not found" });

    // If this file belongs to a folder, pull its own id out of that folder's
    // files array BEFORE deleting — otherwise the Folder document keeps a
    // dangling reference to a File that no longer exists in the database.
    if (file.folderId) {
      await Folder.findByIdAndUpdate(file.folderId, { $pull: { files: file._id } });
    }

    // Supabase deletion is best-effort — a storage error should NOT block
    // the MongoDB record from being deleted (otherwise the file reappears on refresh).
    const storagePath = file.filePath || file.cloudinaryId;
    if (storagePath) {
      const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
      if (error) console.warn(`Supabase remove warning (non-fatal): ${error.message}`);
    }

    // Always delete the DB record regardless of storage result
    await file.deleteOne();
    res.status(200).json({ message: "Deleted!" });
  } catch (e) { res.status(500).json({ message: e.message }); }
};
