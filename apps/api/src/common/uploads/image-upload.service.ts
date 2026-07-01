import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { BadRequestException, Injectable, Logger, PayloadTooLargeException } from '@nestjs/common';
import sharp from 'sharp';

/**
 * Declarative profile for a single image-upload pipeline (avatar, card back,
 * etc.). Adding a new uploaded image type means describing it here, not
 * duplicating sharp / fs bookkeeping.
 */
export interface ImageUploadProfile {
  /** Sub-directory under `UPLOADS_DIR` to write the file into. */
  dir: string;
  /** Target width/height for the resize step (cover, centred). */
  width: number;
  height: number;
  /** WEBP quality 1..100. */
  quality: number;
  /** Hard size cap on the raw inbound bytes. */
  maxBytes: number;
  /** Accepted client-supplied mime types. sharp re-validates the magic bytes. */
  allowedMime: ReadonlySet<string>;
}

/** Allowed inbound mime types shared by all current upload profiles. */
export const DEFAULT_ALLOWED_IMAGE_MIME: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

/**
 * Pipeline shared by every image upload endpoint.
 *
 * Responsibilities:
 *   1. Validate size + mime envelope quickly.
 *   2. Re-encode via sharp (which fails on non-images, so we never trust the
 *      client-supplied content-type).
 *   3. Write the resulting WEBP to disk under `<UPLOADS_DIR>/<profile.dir>/`.
 *
 * The caller (avatar / card-back service) owns the DB write — this service is
 * intentionally storage-agnostic so it can be reused.
 */
@Injectable()
export class ImageUploadService {
  private readonly logger = new Logger(ImageUploadService.name);

  /**
   * Process and persist a single inbound image.
   *
   * The filename is derived from the user id only (caller passes it from the
   * session), so path traversal is structurally impossible.
   */
  async processAndStore(
    uploadsRoot: string,
    profile: ImageUploadProfile,
    userId: string,
    input: { buffer: Buffer; mimeType: string | undefined },
  ): Promise<{ absolutePath: string; relativeUrl: string }> {
    if (input.buffer.length > profile.maxBytes) {
      throw new PayloadTooLargeException({
        code: 'FILE_TOO_LARGE',
        message: `File exceeds ${Math.round(profile.maxBytes / (1024 * 1024))} MB limit`,
      });
    }
    if (!input.mimeType || !profile.allowedMime.has(input.mimeType)) {
      throw new BadRequestException({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Only JPEG, PNG or WEBP images are allowed',
      });
    }

    let webp: Buffer;
    try {
      webp = await sharp(input.buffer, { failOn: 'error' })
        .rotate()
        .resize(profile.width, profile.height, { fit: 'cover', position: 'centre' })
        .webp({ quality: profile.quality })
        .toBuffer();
    } catch (err) {
      this.logger.warn({ err, profile: profile.dir }, 'sharp failed to decode image upload');
      throw new BadRequestException({
        code: 'INVALID_IMAGE',
        message: 'Uploaded file is not a valid image',
      });
    }

    const targetDir = path.join(uploadsRoot, profile.dir);
    await fs.mkdir(targetDir, { recursive: true });
    const filename = `${userId}.webp`;
    const absolutePath = path.join(targetDir, filename);
    await fs.writeFile(absolutePath, webp);

    const relativeUrl = `/uploads/${profile.dir}/${filename}?v=${Date.now()}`;
    return { absolutePath, relativeUrl };
  }

  /** Best-effort delete; ENOENT is treated as success. */
  async remove(uploadsRoot: string, profile: ImageUploadProfile, userId: string): Promise<void> {
    const target = path.join(uploadsRoot, profile.dir, `${userId}.webp`);
    try {
      await fs.unlink(target);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        this.logger.warn({ err, profile: profile.dir }, 'Failed to delete uploaded image');
      }
    }
  }
}
