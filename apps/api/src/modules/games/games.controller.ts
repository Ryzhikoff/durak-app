import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import type {
  GameDetail,
  GameListResponse,
  PauseInfo,
  SameCompositionResponse,
} from '@durak/shared-types';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionPayload } from '../auth/session.service';
import { ListGamesQueryDto } from './dto/list-games.dto';
import { SameCompositionQueryDto } from './dto/same-composition.dto';
import { GamesHistoryService, SAME_COMPOSITION_DEFAULT_LIMIT } from './games-history.service';
import { GamesPauseService } from './games-pause.service';
import { GamesService } from './games.service';
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
    private readonly pause: GamesPauseService,
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
  ): Promise<{ state: ClientGameState; pauseInfo: PauseInfo | null } | { detail: GameDetail }> {
    // Live branch first — the Redis lookup is cheap and the personalised
    // snapshot is what the in-game UI expects.
    const live = await this.games.tryGet(id);
    if (live) {
      const isMember = live.players.some((p) => p.id === session.userId);
      if (isMember) {
        // Bundle the pause snapshot with the state so the client doesn't see a
        // brief overlay-flicker between the REST hydration and the WS subscribe
        // ack. The two queries run in parallel — pauseInfo failure is non-fatal
        // (we fall back to null so the live state still renders).
        const [state, pauseInfo] = await Promise.all([
          this.games.getClientState(id, session.userId),
          this.pause.get(id).catch(() => null),
        ]);
        return { state, pauseInfo };
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

  /**
   * Phase 7B — list past finished games that share the exact same set of
   * participants as `:id`. Active games / unknown ids return 404 so the UI
   * can short-circuit. Sorted by `finishedAt DESC`.
   */
  @Get(':id/same-composition')
  @UseGuards(AuthGuard)
  async sameComposition(
    @Param('id') id: string,
    @Query() q: SameCompositionQueryDto,
  ): Promise<SameCompositionResponse> {
    const result = await this.history.listSameComposition(
      id,
      q.limit ?? SAME_COMPOSITION_DEFAULT_LIMIT,
    );
    if (!result) {
      throw new NotFoundException({
        code: 'GAME_NOT_FOUND',
        message: 'Game not found',
      });
    }
    return result;
  }
}
