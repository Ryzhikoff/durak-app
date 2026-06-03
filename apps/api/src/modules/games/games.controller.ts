import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import type { GameDetail, GameListResponse } from '@durak/shared-types';
import { ListGamesQueryDto } from './dto/list-games.dto';

/**
 * Phase 2 stub: the Game model doesn't exist yet. These endpoints exist so the
 * frontend can wire its API client now; payloads will be filled in Phase 4+.
 */
@Controller('games')
export class GamesController {
  @Get()
  list(@Query() q: ListGamesQueryDto): GameListResponse {
    // `playerId` is accepted (validated) but intentionally ignored for now.
    return {
      items: [],
      total: 0,
      page: q.page ?? 1,
      limit: q.limit ?? 20,
    };
  }

  @Get(':id')
  get(@Param('id') _id: string): GameDetail {
    throw new NotFoundException({ code: 'GAME_NOT_FOUND', message: 'Game not found' });
  }
}
