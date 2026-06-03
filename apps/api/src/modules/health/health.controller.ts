import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { GamesService } from '../games/games.service';
import { LobbiesService } from '../lobbies/lobbies.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly lobbies: LobbiesService,
    private readonly games: GamesService,
  ) {}

  @Get()
  async check(): Promise<{
    status: 'ok' | 'degraded';
    services: { postgres: boolean; redis: boolean };
    lobbies: number;
    games: number;
  }> {
    let pgOk = false;
    let redisOk = false;
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      pgOk = true;
    } catch {
      pgOk = false;
    }
    try {
      redisOk = await this.redis.ping();
    } catch {
      redisOk = false;
    }
    let lobbyCount = 0;
    try {
      lobbyCount = await this.lobbies.count();
    } catch {
      lobbyCount = 0;
    }
    let gameCount = 0;
    try {
      gameCount = await this.games.count();
    } catch {
      gameCount = 0;
    }
    return {
      status: pgOk && redisOk ? 'ok' : 'degraded',
      services: { postgres: pgOk, redis: redisOk },
      lobbies: lobbyCount,
      games: gameCount,
    };
  }
}
