import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type {
  CreateUserTextReactionRequest,
  UpdateUserTextReactionRequest,
  UserTextReactionDTO,
  UserTextReactionsResponse,
} from '@durak/shared-types';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { SessionPayload } from '../../auth/session.service';
import { UserTextReactionsService } from './user-text-reactions.service';

/**
 * Owner-scoped CRUD for the per-user custom text-reaction list. Every endpoint
 * is gated by {@link AuthGuard} and silently scopes every query to the caller's
 * session userId; no admin can manipulate someone else's customs and no user
 * can manipulate someone else's by guessing an id (we 404 instead of 403 so
 * existence is not leaked).
 */
@Controller('me/text-reactions')
@UseGuards(AuthGuard)
export class UserTextReactionsController {
  constructor(private readonly service: UserTextReactionsService) {}

  @Get()
  async list(
    @CurrentUser() session: SessionPayload,
  ): Promise<UserTextReactionsResponse> {
    const reactions = await this.service.list(session.userId);
    return { reactions };
  }

  @Post()
  async create(
    @CurrentUser() session: SessionPayload,
    @Body() body: CreateUserTextReactionRequest,
  ): Promise<UserTextReactionDTO> {
    return this.service.create(session.userId, {
      text: body?.text,
      sortOrder: body?.sortOrder,
    });
  }

  @Patch(':id')
  async update(
    @CurrentUser() session: SessionPayload,
    @Param('id') id: string,
    @Body() body: UpdateUserTextReactionRequest,
  ): Promise<UserTextReactionDTO> {
    return this.service.update(session.userId, id, {
      text: body?.text,
      sortOrder: body?.sortOrder,
    });
  }

  @Delete(':id')
  async remove(
    @CurrentUser() session: SessionPayload,
    @Param('id') id: string,
  ): Promise<{ id: string }> {
    return this.service.remove(session.userId, id);
  }
}
