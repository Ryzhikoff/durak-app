import { Controller, Delete, Post, Req, UseGuards } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { SessionPayload } from '../../auth/session.service';
import { PublicUser } from '../../auth/auth.service';
import { extractSingleUploadedFile } from '../../../common/uploads/multipart-file';
import { CustomCardBackService } from './custom-card-back.service';

@Controller('me/card-back')
@UseGuards(AuthGuard)
export class CustomCardBackController {
  constructor(private readonly service: CustomCardBackService) {}

  @Post()
  async upload(
    @CurrentUser() session: SessionPayload,
    @Req() req: FastifyRequest,
  ): Promise<{ user: PublicUser }> {
    const { buffer, mimeType } = await extractSingleUploadedFile(req);
    const user = await this.service.upload(session.userId, { buffer, mimeType });
    return { user };
  }

  @Delete()
  async remove(@CurrentUser() session: SessionPayload): Promise<{ user: PublicUser }> {
    const user = await this.service.remove(session.userId);
    return { user };
  }
}
