import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PasswordHasher } from '../auth/password-hasher';

@Injectable()
export class AdminSetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
  ) {}

  async isAvailable(): Promise<boolean> {
    const count = await this.prisma.user.count({ where: { isAdmin: true } });
    return count === 0;
  }

  async createFirstAdmin(input: { login: string; password: string; nickname?: string }) {
    const available = await this.isAvailable();
    // Hide the existence of setup endpoint once consumed.
    if (!available) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
    }
    const login = input.login.trim().toLowerCase();
    const nickname = (input.nickname ?? login).trim();

    const dupLogin = await this.prisma.user.findUnique({ where: { login } });
    if (dupLogin) {
      throw new ConflictException({ code: 'LOGIN_TAKEN', message: 'Login already taken' });
    }
    const dupNick = await this.prisma.user.findUnique({ where: { nickname } });
    if (dupNick) {
      throw new ConflictException({ code: 'NICKNAME_TAKEN', message: 'Nickname already taken' });
    }
    const passwordHash = await this.hasher.hash(input.password);
    return this.prisma.user.create({
      data: {
        login,
        nickname,
        passwordHash,
        isAdmin: true,
        mustChangePassword: false,
      },
    });
  }
}
