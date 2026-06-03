import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';

export interface SessionPayload {
  userId: string;
  isAdmin: boolean;
  mustChangePassword: boolean;
}

export interface CreateSessionInput extends SessionPayload {
  userAgent?: string;
  ip?: string;
}

const SESSION_KEY_PREFIX = 'sess:';

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private ttl(): number {
    return this.config.get<number>('SESSION_TTL_SECONDS') ?? 60 * 60 * 24 * 30;
  }

  private key(id: string): string {
    return `${SESSION_KEY_PREFIX}${id}`;
  }

  private generateId(): string {
    return randomBytes(32).toString('base64url');
  }

  async create(input: CreateSessionInput): Promise<{ id: string; ttlSeconds: number }> {
    const id = this.generateId();
    const ttl = this.ttl();
    const payload: SessionPayload = {
      userId: input.userId,
      isAdmin: input.isAdmin,
      mustChangePassword: input.mustChangePassword,
    };
    await this.redis.client.set(this.key(id), JSON.stringify(payload), 'EX', ttl);
    try {
      await this.prisma.session.create({
        data: {
          id,
          userId: input.userId,
          userAgent: input.userAgent?.slice(0, 512),
          ip: input.ip?.slice(0, 64),
        },
      });
    } catch (err) {
      this.logger.warn({ err }, 'Failed to persist session audit row');
    }
    return { id, ttlSeconds: ttl };
  }

  async get(id: string): Promise<SessionPayload | null> {
    const raw = await this.redis.client.get(this.key(id));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SessionPayload;
    } catch {
      return null;
    }
  }

  /** Refresh TTL & lastSeenAt lazily on every authenticated request. */
  async touch(id: string): Promise<void> {
    const ttl = this.ttl();
    await this.redis.client.expire(this.key(id), ttl);
    // Best-effort: lastSeenAt update is async and non-blocking on failure.
    this.prisma.session
      .update({ where: { id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  }

  async update(id: string, partial: Partial<SessionPayload>): Promise<void> {
    const current = await this.get(id);
    if (!current) return;
    const merged: SessionPayload = { ...current, ...partial };
    const ttl = await this.redis.client.ttl(this.key(id));
    const finalTtl = ttl > 0 ? ttl : this.ttl();
    await this.redis.client.set(this.key(id), JSON.stringify(merged), 'EX', finalTtl);
  }

  async destroy(id: string): Promise<void> {
    await this.redis.client.del(this.key(id));
    await this.prisma.session.deleteMany({ where: { id } }).catch(() => undefined);
  }

  async destroyAllForUser(userId: string): Promise<void> {
    const rows = await this.prisma.session.findMany({ where: { userId }, select: { id: true } });
    if (rows.length > 0) {
      const keys = rows.map((r) => this.key(r.id));
      await this.redis.client.del(keys);
    }
    await this.prisma.session.deleteMany({ where: { userId } });
  }

  /**
   * Destroy all sessions for the given user EXCEPT the one identified by
   * `keepSessionId`. Used after a self-initiated password change so the
   * user remains logged in on the current device but is forced out elsewhere.
   */
  async destroyAllForUserExcept(userId: string, keepSessionId: string): Promise<void> {
    const rows = await this.prisma.session.findMany({
      where: { userId, id: { not: keepSessionId } },
      select: { id: true },
    });
    if (rows.length > 0) {
      const keys = rows.map((r) => this.key(r.id));
      await this.redis.client.del(keys);
    }
    await this.prisma.session.deleteMany({ where: { userId, id: { not: keepSessionId } } });
  }
}
