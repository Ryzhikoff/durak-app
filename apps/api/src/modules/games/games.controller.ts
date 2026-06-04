import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import type { GameDetail, GameListResponse } from '@durak/shared-types';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionPayload } from '../auth/session.service';
import { ListGamesQueryDto } from './dto/list-games.dto';
import { GamesService } from './games.service';
import { GamesHistoryService } from './games-history.service';
import type { ClientGameState } from './game-redactor';

/**
 * Phase 7A: history endpoints. Live games still come from Redis; finished
 * games are read from Postgres via {@link GamesHistoryService}.
 */
@Controller('games')
export class GamesController {
  constructor(
    private readonly games: GamesService,
    private readonly history: GamesHistoryService,
  ) {}

  @Get()
  @UseGuards(AuthGuard)
  list(@Query() q: ListGamesQueryDto): Promise<GameListResponse> {
    return this.history.list({
      page: q.page ?? 1,
      limit: q.limit ?? 20,
      playerId: q.playerId,
    });
  }

  /**
   * Returns either a personalised live snapshot (participant of an active
   * game) or a finished-game public detail (Postgres). Membership rules for
   * the live branch are unchanged from Phase 5; finished games are public.
   *
   * After `game_over` the live snapshot survives for GAME_OVER_TTL (30m) in
   * Redis so re-entering participants see the final board. But during that
   * window the same gameId ALSO exists in Postgres. A non-participant hitting
   * this route would otherwise get a 404 (live branch rejects them) — we
   * fall through to Postgres so spectators / link sharers see the public
   * detail right away.
   */
  @Get(':id')
  @UseGuards(AuthGuard)
  async get(
    @Param('id') id: string,
    @CurrentUser() session: SessionPayload,
  ): Promise<{ state: ClientGameState } | { detail: GameDetail }> {
    // Live branch first — the Redis lookup is cheap and the personalised
    // snapshot is what the in-game UI expects.
    const live = await this.games.tryGet(id);
    if (live) {
      const isMember = live.players.some((p) => p.id === session.userId);
      if (isMember) {
        const state = await this.games.getClientState(id, session.userId);
        return { state };
      }
      // Non-participant: don't short-circuit to 404. Fall through to
      // Postgres so a finished-game GameDetail is returned when available.
    }
    const detail = await this.history.getDetail(id);
    if (!detail) {
      throw new NotFoundException({ code: 'GAME_NOT_FOUND', message: 'Game not found' });
    }
    return { detail };
  }
}
