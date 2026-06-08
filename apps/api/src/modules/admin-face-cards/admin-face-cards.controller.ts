import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { AdminGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionPayload } from '../auth/session.service';
import { extractSingleUploadedFile } from '../../common/uploads/multipart-file';
import { AdminFaceCardsService, FaceCardAssetDto } from './admin-face-cards.service';

@Controller('admin/face-cards')
@UseGuards(AdminGuard)
export class AdminFaceCardsController {
  constructor(private readonly service: AdminFaceCardsService) {}

  @Get()
  async list(): Promise<{ assets: FaceCardAssetDto[] }> {
    const assets = await this.service.list();
    return { assets };
  }

  @Post(':rank/:suit')
  async upload(
    @Param('rank') rankParam: string,
    @Param('suit') suitParam: string,
    @CurrentUser() session: SessionPayload,
    @Req() req: FastifyRequest,
  ): Promise<FaceCardAssetDto> {
    const { rank, suit } = AdminFaceCardsService.parseSlot(rankParam, suitParam);
    const { buffer, mimeType } = await extractSingleUploadedFile(req);
    return this.service.upload(rank, suit, session.userId, { buffer, mimeType });
  }

  @Delete(':rank/:suit')
  async remove(
    @Param('rank') rankParam: string,
    @Param('suit') suitParam: string,
  ): Promise<FaceCardAssetDto> {
    const { rank, suit } = AdminFaceCardsService.parseSlot(rankParam, suitParam);
    return this.service.remove(rank, suit);
  }
}
