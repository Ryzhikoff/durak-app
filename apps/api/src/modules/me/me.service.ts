import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuthService, PublicUser } from '../auth/auth.service';
import { CardBacksService } from '../card-backs/card-backs.service';
import { CUSTOM_CARD_BACK_ID, RANDOM_CARD_BACK_OPTION_ID } from '../card-backs/card-backs.data';
import { UpdateMeDto } from './dto/update-me.dto';

export interface IMePrismaClient {
  user: {
    findUnique(args: {
      where: { id: string };
      select: { customCardBackUrl: true };
    }): Promise<{ customCardBackUrl: string | null } | null>;
    update(args: {
      where: { id: string };
      data: Prisma.UserUpdateInput;
    }): Promise<Parameters<AuthService['toPublicUser']>[0]>;
  };
}

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly cardBacks: CardBacksService,
  ) {}

  async update(userId: string, dto: UpdateMeDto): Promise<{ user: PublicUser }> {
    return MeService.run(
      this.prisma as unknown as IMePrismaClient,
      this.cardBacks,
      this.auth,
      userId,
      dto,
    );
  }

  /**
   * Pure functional core for testability.
   *
   * `cardBackId` is validated against the canonical CardBacksService catalog
   * plus the `'__custom__'` sentinel (when the user has actually uploaded a
   * custom back). The `'__random__'` sentinel is rejected here on purpose: the
   * frontend is expected to use `randomCardBack=true` to express "random per
   * game" and must not persist the sentinel as a real id.
   */
  static async run(
    prisma: IMePrismaClient,
    cardBacks: CardBacksService,
    auth: AuthService,
    userId: string,
    dto: UpdateMeDto,
  ): Promise<{ user: PublicUser }> {
    if (dto.cardBackId !== undefined) {
      if (dto.cardBackId === RANDOM_CARD_BACK_OPTION_ID) {
        throw new BadRequestException({
          code: 'CARD_BACK_NOT_FOUND',
          message: 'Card back not found',
        });
      }
      if (dto.cardBackId === CUSTOM_CARD_BACK_ID) {
        const existing = await prisma.user.findUnique({
          where: { id: userId },
          select: { customCardBackUrl: true },
        });
        if (!existing || existing.customCardBackUrl === null) {
          throw new BadRequestException({
            code: 'CUSTOM_CARD_BACK_NOT_SET',
            message: 'Upload a custom card back first',
          });
        }
      } else if (!cardBacks.find(dto.cardBackId)) {
        throw new BadRequestException({
          code: 'CARD_BACK_NOT_FOUND',
          message: 'Card back not found',
        });
      }
    }

    const data: Prisma.UserUpdateInput = {};
    if (dto.nickname !== undefined) data.nickname = dto.nickname;
    if (dto.cardBackId !== undefined) data.cardBackId = dto.cardBackId;
    if (dto.randomCardBack !== undefined) data.randomCardBack = dto.randomCardBack;

    try {
      const updated = await prisma.user.update({
        where: { id: userId },
        data,
      });
      const currentGameId = await auth.resolveCurrentGameId(userId);
      return { user: auth.toPublicUser(updated, currentGameId) };
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
