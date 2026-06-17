import { randomUUID } from "crypto";
import File from "../models/File.js";
import Folder from "../models/Folder.js";
import supabase from "../config/supabase.js";
import { Readable } from "stream";

const BUCKET = process.env.SUPABASE_BUCKET || "cloudvault-files";

// Shared token generator — 16-char hex string, no extra dependencies
const generateToken = () => randomUUID().replace(/-/g, "").slice(0, 16);

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

    const result = await uploadToSupabase(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );
    filePath = result.filePath;

    // Explicitly generate shareToken — don't rely on schema default,
    // which can silently fail on some Mongoose versions with sparse unique indexes.
    const file = await File.create({
      originalName: req.file.originalname,
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
      { originalName: name.trim() },
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
    const { visibility } = req.body;
    if (!["public", "private"].includes(visibility)) {
      return res.status(400).json({ message: "visibility must be 'public' or 'private'" });
    }
    const file = await File.findByIdAndUpdate(
      req.params.id,
      { visibility },
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
