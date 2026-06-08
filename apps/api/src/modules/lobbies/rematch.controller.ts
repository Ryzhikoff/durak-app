import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import type { RematchResponse } from '@durak/shared-types';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionPayload } from '../auth/session.service';
import { LobbiesService } from './lobbies.service';

/**
 * Rematch — `POST /games/:id/rematch`.
 *
 * Lives in the lobbies module (not games) because the heavy lifting
 * (`LobbiesService.rematch`) creates a fresh lobby — which is firmly lobby
 * territory. The route is namespaced under `/games/:id` because, from the
 * UI's perspective, the action originates on the finished-game detail view.
 *
 * Errors (translated by the web app via the i18n `errors.*` table):
 *  - `GAME_NOT_FOUND` (404) — unknown / still-active game id.
 *  - `NOT_A_PARTICIPANT` (403) — caller did not play in the source game.
 *  - `REMATCH_WINDOW_CLOSED` (400) — too long since the game finished.
 *  - `ALREADY_IN_LOBBY` (409) — caller already has an active lobby.
 */
@Controller('games')
export class RematchController {
  constructor(private readonly lobbies: LobbiesService) {}

  @Post(':id/rematch')
  @UseGuards(AuthGuard)
  @HttpCode(201)
  async rematch(
    @Param('id') gameId: string,
    @CurrentUser() session: SessionPayload,
  ): Promise<RematchResponse> {
    const { lobby } = await this.lobbies.rematch(session.userId, gameId);
    return { lobbyId: lobby.id };
  }
}
