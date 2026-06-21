import mongoose from "mongoose";
import { randomUUID } from "crypto";

const generateToken = () => randomUUID().replace(/-/g, "").slice(0, 16);

const folderSchema = new mongoose.Schema(
  {
    name: {
      type:     String,
      required: true,
      trim:     true,
    },

    // Same token pattern as File — 16-char hex, auto-generated
    shareToken: {
      type:    String,
      unique:  true,
      sparse:  true,
      index:   true,
      default: generateToken,
    },

    // public  → visible in folders list
    // private → only accessible via shareToken
    visibility: {
      type:    String,
      enum:    ["public", "private"],
      default: "public",
    },

    // Same expiry rule as File — null means never expires.
    tokenExpiresAt: { type: Date, default: null },

    // Array of File _ids that belong to this folder
    files: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref:  "File",
      },
    ],
  },
  {
    timestamps: true,
    toJSON:     { virtuals: true }, // include virtuals in responses
  }
);

// Convenience virtual — avoids populating just to get a count
folderSchema.virtual("fileCount").get(function () {
  return this.files.length;
});

export default mongoose.model("Folder", folderSchema);
