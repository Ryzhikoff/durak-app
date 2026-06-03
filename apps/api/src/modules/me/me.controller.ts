import { Body, ConflictException, Controller, Patch, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthService, PublicUser } from '../auth/auth.service';
import { SessionPayload } from '../auth/session.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { UpdateMeDto } from './dto/update-me.dto';

@Controller('me')
@UseGuards(AuthGuard)
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  @Patch()
  async update(
    @CurrentUser() session: SessionPayload,
    @Body() dto: UpdateMeDto,
  ): Promise<{ user: PublicUser }> {
    const data: Prisma.UserUpdateInput = {};
    if (dto.nickname !== undefined) data.nickname = dto.nickname;
    if (dto.cardBackId !== undefined) data.cardBackId = dto.cardBackId;
    if (dto.randomCardBack !== undefined) data.randomCardBack = dto.randomCardBack;

    try {
      const updated = await this.prisma.user.update({
        where: { id: session.userId },
        data,
      });
      return { user: this.auth.toPublicUser(updated) };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        Array.isArray(err.meta?.target) &&
        (err.meta?.target as string[]).includes('nickname')
      ) {
        throw new ConflictException({
          code: 'NICKNAME_TAKEN',
          message: 'Nickname already taken',
        });
      }
      throw err;
    }
  }
}
