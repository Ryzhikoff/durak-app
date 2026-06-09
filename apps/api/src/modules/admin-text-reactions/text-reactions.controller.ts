import { Controller, Get, Header } from '@nestjs/common';
import type { TextReactionsResponse } from '@durak/shared-types';
import { AdminTextReactionsService } from './admin-text-reactions.service';

/**
 * Public, unguarded read-only surface for the enabled text-reaction list.
 * Every client hits this once on game-page mount; admin CRUD mutations
 * invalidate the matching TanStack-Query cache so updates land without a
 * manual refetch.
 *
 * `max-age=60` is friendly enough for the picker but quick enough that a
 * freshly added phrase shows up "within a minute" on tabs that didn't see
 * the admin mutation.
 */
@Controller('text-reactions')
export class TextReactionsController {
  constructor(private readonly service: AdminTextReactionsService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  async list(): Promise<TextReactionsResponse> {
    const reactions = await this.service.listEnabled();
    return { reactions };
  }
}
