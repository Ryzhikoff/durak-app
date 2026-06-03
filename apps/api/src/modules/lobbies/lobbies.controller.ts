import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import type { Lobby, LobbySummary } from '@durak/shared-types';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionPayload } from '../auth/session.service';
import { LobbiesService } from './lobbies.service';
import { CreateLobbyDto } from './dto/create-lobby.dto';

@Controller('lobbies')
@UseGuards(AuthGuard)
export class LobbiesController {
  constructor(private readonly lobbies: LobbiesService) {}

  @Post()
  @HttpCode(201)
  async create(
    @CurrentUser() session: SessionPayload,
    @Body() dto: CreateLobbyDto,
  ): Promise<{ lobby: Lobby }> {
    const lobby = await this.lobbies.create(session.userId, dto.settings);
    return { lobby };
  }

  @Get()
  async list(): Promise<{ items: LobbySummary[] }> {
    const items = await this.lobbies.list();
    return { items };
  }

  /**
   * Escape hatch: force-leave whatever lobby the caller is currently in. Used
   * by the web UI when a stale WS connection has left a user "stuck" — without
   * this, the only way out would be the 1h idle TTL. Idempotent: returns 204
   * either way (already-out is success).
   *
   * NB: keep this route ABOVE `:id` so Nest doesn't match `leave` as an id.
   */
  @Post('leave')
  @HttpCode(204)
  async leave(@CurrentUser() session: SessionPayload): Promise<void> {
    await this.lobbies.leaveCurrent(session.userId);
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<{ lobby: Lobby }> {
    const lobby = await this.lobbies.get(id);
    return { lobby };
  }
}
