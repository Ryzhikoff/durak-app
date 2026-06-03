import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type { GameListResponse } from '@durak/shared-types';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionPayload } from '../auth/session.service';
import { ListGamesQueryDto } from './dto/list-games.dto';
import { GamesService } from './games.service';
import type { ClientGameState } from './game-redactor';

/**
 * Phase 5: live games. The `/games` list endpoint stays empty (Phase 7 will
 * introduce a Postgres-backed history). The `:id` endpoint is a REST escape
 * hatch for the WS path — fetches a personalised snapshot.
 */
@Controller('games')
export class GamesController {
  constructor(private readonly games: GamesService) {}

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

  /**
   * Personalised snapshot of a live (or recently-ended) game. The auth guard
   * resolves the caller; membership is enforced inside the service via 404.
   */
  @Get(':id')
  @UseGuards(AuthGuard)
  async get(
    @Param('id') id: string,
    @CurrentUser() session: SessionPayload,
  ): Promise<{ state: ClientGameState }> {
    const state = await this.games.getClientState(id, session.userId);
    return { state };
  }
}
