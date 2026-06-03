import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuthService, PublicUser } from '../../auth/auth.service';
import {
  DEFAULT_ALLOWED_IMAGE_MIME,
  ImageUploadProfile,
  ImageUploadService,
} from '../../../common/uploads/image-upload.service';

const AVATAR_PROFILE: ImageUploadProfile = {
  dir: 'avatars',
  width: 256,
  height: 256,
  quality: 80,
  maxBytes: 5 * 1024 * 1024,
  allowedMime: DEFAULT_ALLOWED_IMAGE_MIME,
};

@Injectable()
export class AvatarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
    private readonly uploads: ImageUploadService,
  ) {}

  private uploadsRoot(): string {
    return this.config.get<string>('UPLOADS_DIR') ?? '/data/uploads';
  }

  async upload(
    userId: string,
    input: { buffer: Buffer; mimeType: string | undefined },
  ): Promise<PublicUser> {
    const { relativeUrl } = await this.uploads.processAndStore(
      this.uploadsRoot(),
      AVATAR_PROFILE,
      userId,
      input,
    );
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: relativeUrl },
    });
    return this.auth.toPublicUser(updated);
  }

  async remove(userId: string): Promise<PublicUser> {
    await this.uploads.remove(this.uploadsRoot(), AVATAR_PROFILE, userId);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null },
    });
    return this.auth.toPublicUser(updated);
  }
}
