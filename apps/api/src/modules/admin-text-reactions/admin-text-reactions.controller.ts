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
  AdminCreateTextReactionRequest,
  AdminTextReactionDTO,
  AdminTextReactionsResponse,
  AdminUpdateTextReactionRequest,
} from '@durak/shared-types';
import { AdminGuard } from '../auth/auth.guard';
import { AdminTextReactionsService } from './admin-text-reactions.service';

/**
 * Admin CRUD for the preset text-reaction list. Mirrors the singleton/CRUD
 * style of {@link AdminFaceCardsController} but with a real per-row id since
 * admins maintain an open-ended list rather than 12 fixed slots.
 */
@Controller('admin/text-reactions')
@UseGuards(AdminGuard)
export class AdminTextReactionsController {
  constructor(private readonly service: AdminTextReactionsService) {}

  @Get()
  async list(): Promise<AdminTextReactionsResponse> {
    const reactions = await this.service.list();
    return { reactions };
  }

  @Post()
  async create(
    @Body() body: AdminCreateTextReactionRequest,
  ): Promise<AdminTextReactionDTO> {
    return this.service.create({
      text: body?.text,
      sortOrder: body?.sortOrder,
      enabled: body?.enabled,
    });
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: AdminUpdateTextReactionRequest,
  ): Promise<AdminTextReactionDTO> {
    return this.service.update(id, {
      text: body?.text,
      sortOrder: body?.sortOrder,
      enabled: body?.enabled,
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ id: string }> {
    return this.service.remove(id);
  }
}
