import { Controller, Get } from '@nestjs/common';
import { AdminFaceCardsService, FaceCardAssetDto } from './admin-face-cards.service';

/**
 * Public, unguarded read-only surface for the face-card asset map. Every
 * client (including spectators and the lobby) hits this on boot and on cache
 * invalidation; admin upload/delete trigger refetches via the React Query
 * cache key shared with this endpoint.
 */
@Controller('face-cards')
export class FaceCardsController {
  constructor(private readonly service: AdminFaceCardsService) {}

  @Get()
  async list(): Promise<{ assets: FaceCardAssetDto[] }> {
    const assets = await this.service.list();
    return { assets };
  }
}
