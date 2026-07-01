import { Global, Module } from '@nestjs/common';
import { ImageUploadService } from './image-upload.service';

/**
 * Shared image-upload pipeline. Marked `@Global()` so consumers (avatar,
 * card-back, etc.) can inject `ImageUploadService` without re-importing.
 */
@Global()
@Module({
  providers: [ImageUploadService],
  exports: [ImageUploadService],
})
export class UploadsModule {}
