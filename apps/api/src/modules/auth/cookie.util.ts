import { ConfigService } from '@nestjs/config';
import { FastifyReply } from 'fastify';
import { SESSION_COOKIE_NAME } from './auth.constants';

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  domain?: string;
  maxAge?: number;
}

export function buildSessionCookieOptions(
  config: ConfigService,
  maxAgeSeconds?: number,
): CookieOptions {
  const opts: CookieOptions = {
    httpOnly: true,
    secure: config.get<boolean>('COOKIE_SECURE') ?? false,
    sameSite: 'lax',
    path: '/',
  };
  const domain = config.get<string>('COOKIE_DOMAIN');
  if (domain) opts.domain = domain;
  if (maxAgeSeconds !== undefined) opts.maxAge = maxAgeSeconds;
  return opts;
}

export function setSessionCookie(
  reply: FastifyReply,
  sessionId: string,
  ttlSeconds: number,
  config: ConfigService,
): void {
  const opts = buildSessionCookieOptions(config, ttlSeconds);
  // @fastify/cookie augments reply with setCookie.
  (
    reply as FastifyReply & {
      setCookie: (name: string, val: string, opts: CookieOptions) => FastifyReply;
    }
  ).setCookie(SESSION_COOKIE_NAME, sessionId, opts);
}

export function clearSessionCookie(reply: FastifyReply, config: ConfigService): void {
  const opts = buildSessionCookieOptions(config, 0);
  (
    reply as FastifyReply & {
      clearCookie: (name: string, opts: CookieOptions) => FastifyReply;
    }
  ).clearCookie(SESSION_COOKIE_NAME, opts);
}
