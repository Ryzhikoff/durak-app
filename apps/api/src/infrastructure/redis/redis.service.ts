import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private _client!: Redis;

  constructor(private readonly config: ConfigService) {}

  get client(): Redis {
    if (!this._client) {
      throw new Error('Redis client accessed before initialization');
    }
    return this._client;
  }

  async onModuleInit(): Promise<void> {
    const url = this.config.get<string>('REDIS_URL');
    if (!url) {
      throw new Error('REDIS_URL is not set');
    }
    this._client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });

    this._client.on('error', (err) => {
      this.logger.error({ err }, 'Redis error');
    });

    await this._client.connect();
    this.logger.log('Redis connected');
  }

  async onModuleDestroy(): Promise<void> {
    if (this._client) {
      await this._client.quit().catch(() => undefined);
      this.logger.log('Redis disconnected');
    }
  }

  async ping(): Promise<boolean> {
    const res = await this._client.ping();
    return res === 'PONG';
  }
}
