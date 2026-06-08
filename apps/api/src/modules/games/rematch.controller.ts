import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import type { RematchAcceptedResponse, RematchInitiatedResponse } from '@durak/shared-types';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionPayload } from '../auth/session.service';
import { RematchService } from './rematch.service';

/**
 * Rematch HTTP surface. Lives in the games module — there is no lobby in the
 * rematch flow anymore.
 *
 *  - `POST /games/:id/rematch` — initiate or idempotent accept.
 *  - `POST /games/:id/rematch/accept` — accept an existing session.
 *  - `POST /games/:id/rematch/cancel` — cancel (initiator) or decline (invitee).
 *
 * Errors (translated by the web app via the i18n `errors.*` table):
 *  - `GAME_NOT_FOUND` (404) — unknown source game.
 *  - `NOT_A_PARTICIPANT` (403) — caller did not play in the source game.
 *  - `REMATCH_WINDOW_CLOSED` (400) — too long since the game finished.
 *  - `REMATCH_NOT_FOUND` (404) — accept/cancel without an active session.
 *  - `REMATCH_EXPIRED` (410) — accept after the session TTL fired.
 */
@Controller('games')
export class RematchController {
  constructor(private readonly rematch: RematchService) {}

  @Post(':id/rematch')
  @UseGuards(AuthGuard)
  @HttpCode(201)
  async initiate(
    @Param('id') gameId: string,
    @CurrentUser() session: SessionPayload,
  ): Promise<RematchInitiatedResponse> {
    const result = await this.rematch.initiateOrAccept(session.userId, gameId);
    return { session: result };
  }

  @Post(':id/rematch/accept')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async accept(
    @Param('id') gameId: string,
    @CurrentUser() session: SessionPayload,
  ): Promise<RematchAcceptedResponse> {
    const result = await this.rematch.accept(session.userId, gameId);
    return { session: result };
  }

  @Post(':id/rematch/cancel')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async cancel(
    @Param('id') gameId: string,
    @CurrentUser() session: SessionPayload,
  ): Promise<{ cancelled: true }> {
    await this.rematch.cancel(session.userId, gameId, 'cancelled');
    return { cancelled: true };
  }
}
