import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check(): Promise<{
    status: 'ok' | 'degraded';
    services: { postgres: boolean; redis: boolean };
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
    return {
      status: pgOk && redisOk ? 'ok' : 'degraded',
      services: { postgres: pgOk, redis: redisOk },
    };
  }
}
