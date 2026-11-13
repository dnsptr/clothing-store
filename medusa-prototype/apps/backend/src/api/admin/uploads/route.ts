import { extname } from "node:path";
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import { uploadFilesWorkflow } from "@medusajs/medusa/core-flows";

interface UploadRequest extends MedusaRequest {
  files?: { originalname: string; mimetype: string; buffer: Buffer }[];
}

/** Publish only passive media on the authenticated API origin. */
export async function POST(req: UploadRequest, res: MedusaResponse): Promise<void> {
  const files = req.files;
  if (!Array.isArray(files) || files.length === 0 || files.length > 10) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Upload between 1 and 10 supported media files");
  }
  let totalBytes = 0;
  for (const file of files) {
    const bytes = file.buffer;
    const extension = extname(file.originalname).toLowerCase();
    const isPng = extension === ".png" && file.mimetype === "image/png" &&
      bytes.length >= 8 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.readUInt32BE(4) === 0x0d0a1a0a;
    const isJpeg = (extension === ".jpg" || extension === ".jpeg") && file.mimetype === "image/jpeg" &&
      bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const isWebp = extension === ".webp" && file.mimetype === "image/webp" &&
      bytes.length >= 12 && bytes.readUInt32BE(0) === 0x52494646 && bytes.readUInt32BE(8) === 0x57454250; // RIFF / WEBP
    const isGif = extension === ".gif" && file.mimetype === "image/gif" &&
      bytes.length >= 6 && bytes.readUInt32BE(0) === 0x47494638 &&
      (bytes[4] === 55 || bytes[4] === 57) && bytes[5] === 97; // GIF87a / GIF89a
    const isMp4 = extension === ".mp4" && file.mimetype === "video/mp4" &&
      bytes.length >= 12 && bytes.readUInt32BE(4) === 0x66747970; // ftyp
    const isWebm = extension === ".webm" && file.mimetype === "video/webm" &&
      bytes.length >= 4 && bytes.readUInt32BE(0) === 0x1a45dfa3;
    totalBytes += bytes.length;
    const isVideo = isMp4 || isWebm;
    if (!(isPng || isJpeg || isWebp || isGif || isVideo) || bytes.length > (isVideo ? 20 : 5) * 1024 * 1024 || totalBytes > 20 * 1024 * 1024) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Allowed: PNG, JPEG, WebP and GIF up to 5 MB; MP4 and WebM up to 20 MB; 20 MB total");
    }
  }
  const { result } = await uploadFilesWorkflow(req.scope).run({
    input: { files: files.map(file => ({ filename: file.originalname, mimeType: file.mimetype, content: file.buffer.toString("base64"), access: "public" })) },
  });
  res.status(200).json({ files: result });
}
