import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { FastifyRequest } from 'fastify';

/**
 * Minimal structural shape of a `@fastify/multipart` file. We avoid extending
 * the request module's own typing (TS2430 from declaration-merging conflicts)
 * by casting through `unknown`.
 */
export interface MultipartFileLike {
  fieldname: string;
  filename: string;
  mimetype: string;
  toBuffer(): Promise<Buffer>;
}

interface MultipartCapableRequest {
  isMultipart(): boolean;
  file(): Promise<MultipartFileLike | undefined>;
}

/**
 * Shared helper: extract a single `file`-field upload from a Fastify multipart
 * request and return its buffer + mimetype. Centralises the error mapping that
 * both the avatar and the card-back controllers need.
 */
export async function extractSingleUploadedFile(
  req: FastifyRequest,
): Promise<{ buffer: Buffer; mimeType: string | undefined }> {
  const mp = req as unknown as MultipartCapableRequest;
  if (typeof mp.isMultipart !== 'function' || !mp.isMultipart()) {
    throw new BadRequestException({
      code: 'NOT_MULTIPART',
      message: 'Expected multipart/form-data',
    });
  }

  let file: MultipartFileLike | undefined;
  try {
    file = await mp.file();
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'FST_REQ_FILE_TOO_LARGE') {
      throw new PayloadTooLargeException({
        code: 'FILE_TOO_LARGE',
        message: 'File exceeds 5 MB limit',
      });
    }
    throw new BadRequestException({
      code: 'INVALID_UPLOAD',
      message: 'Invalid multipart upload',
    });
  }
  if (!file) {
    throw new BadRequestException({
      code: 'FILE_REQUIRED',
      message: 'file field is required',
    });
  }
  if (file.fieldname !== 'file') {
    throw new BadRequestException({
      code: 'FILE_FIELD_NAME',
      message: 'File must be uploaded under field name "file"',
    });
  }

  let buffer: Buffer;
  try {
    buffer = await file.toBuffer();
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'FST_REQ_FILE_TOO_LARGE') {
      throw new PayloadTooLargeException({
        code: 'FILE_TOO_LARGE',
        message: 'File exceeds 5 MB limit',
      });
    }
    throw new BadRequestException({
      code: 'INVALID_UPLOAD',
      message: 'Failed to read uploaded file',
    });
  }

  return { buffer, mimeType: file.mimetype };
}
