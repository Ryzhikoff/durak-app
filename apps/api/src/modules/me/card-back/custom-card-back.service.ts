import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { AuthService, PublicUser } from '../../auth/auth.service';
import {
  DEFAULT_ALLOWED_IMAGE_MIME,
  ImageUploadProfile,
  ImageUploadService,
} from '../../../common/uploads/image-upload.service';
import { CUSTOM_CARD_BACK_ID } from '../../card-backs/card-backs.data';

/**
 * Card-backs follow the canonical playing-card aspect ratio (5:7). 360×504 is
 * the smallest multiple that still gives crisp retina rendering for the in-game
 * card.
 */
const CUSTOM_CARD_BACK_PROFILE: ImageUploadProfile = {
  dir: 'card-backs',
  width: 360,
  height: 504,
  quality: 85,
  maxBytes: 5 * 1024 * 1024,
  allowedMime: DEFAULT_ALLOWED_IMAGE_MIME,
};

@Injectable()
export class CustomCardBackService {
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
      CUSTOM_CARD_BACK_PROFILE,
      userId,
      input,
    );
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { customCardBackUrl: relativeUrl },
    });
    return this.auth.toPublicUser(updated);
  }

  /**
   * Delete the uploaded file and clear the URL. If the user currently has
   * `cardBackId === '__custom__'`, we also reset them to the default
   * `'classic-1'` — otherwise they'd be stuck on an invalid id with no way to
   * render a back until they pick another from the catalog.
   */
  async remove(userId: string): Promise<PublicUser> {
    await this.uploads.remove(this.uploadsRoot(), CUSTOM_CARD_BACK_PROFILE, userId);
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { cardBackId: true },
    });
    const resetCardBackId = existing?.cardBackId === CUSTOM_CARD_BACK_ID;
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        customCardBackUrl: null,
        ...(resetCardBackId ? { cardBackId: 'classic-1' } : {}),
      },
    });
    return this.auth.toPublicUser(updated);
  }
}
