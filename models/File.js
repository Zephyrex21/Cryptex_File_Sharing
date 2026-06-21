import mongoose from "mongoose";
import { randomUUID } from "crypto";

const generateToken = () => randomUUID().replace(/-/g, "").slice(0, 16);

const fileSchema = new mongoose.Schema(
  {
    originalName: { type: String, required: true },

    // ── Storage fields (storage-agnostic; old cloudinary* kept for compat) ──
    fileUrl:       { type: String },
    filePath:      { type: String },
    cloudinaryUrl: { type: String },
    cloudinaryId:  { type: String },

    fileType:    { type: String },
    fileSize:    { type: Number },
    storageType: { type: String, default: "supabase" },

    // ── Sharing ─────────────────────────────────────────────────────────────
    // sparse: true → unique index ignores existing docs where token is null/undefined
    shareToken: {
      type:    String,
      unique:  true,
      sparse:  true,
      index:   true,
      default: generateToken,
    },

    // public  → appears in main gallery
    // private → hidden from gallery; accessible only via shareToken
    visibility: {
      type:    String,
      enum:    ["public", "private"],
      default: "public",   // existing files stay visible — no disruption
    },

    // Optional self-destruct for the token. null = never expires.
    // Only enforced on token-lookup (getFileByToken) — going public clears it,
    // since expiry is meaningless once something isn't gated behind a token.
    tokenExpiresAt: { type: Date, default: null },

    // Optional — which folder this file belongs to (null = not in any folder)
    folderId: {
      type:    mongoose.Schema.Types.ObjectId,
      ref:     "Folder",
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model("File", fileSchema);
