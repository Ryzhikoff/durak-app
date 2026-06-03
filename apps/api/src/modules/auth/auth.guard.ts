import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { SessionPayload, SessionService } from './session.service';
import { SESSION_COOKIE_NAME } from './auth.constants';

export interface AuthedRequest extends FastifyRequest {
  user: SessionPayload;
  sessionId: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const sid = this.extractCookie(req);
    if (!sid) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Not authenticated' });
    }
    const payload = await this.sessions.get(sid);
    if (!payload) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Session expired' });
    }
    // Touch lazily (refresh TTL).
    this.sessions.touch(sid).catch(() => undefined);
    (req as AuthedRequest).user = payload;
    (req as AuthedRequest).sessionId = sid;
    return true;
  }

  private extractCookie(req: FastifyRequest): string | undefined {
    // @fastify/cookie populates req.cookies
    const cookies = (req as FastifyRequest & { cookies?: Record<string, string | undefined> })
      .cookies;
    const raw = cookies?.[SESSION_COOKIE_NAME];
    if (!raw) return undefined;
    return raw;
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly authGuard: AuthGuard) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const ok = await this.authGuard.canActivate(ctx);
    if (!ok) return false;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (!req.user?.isAdmin) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Admin only' });
    }
    return true;
  }
}
