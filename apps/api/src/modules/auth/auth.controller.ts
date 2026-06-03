import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService, PublicUser } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuthGuard } from './auth.guard';
import { CurrentUser, SessionId } from './current-user.decorator';
import { SessionPayload } from './session.service';
import { clearSessionCookie, setSessionCookie } from './cookie.util';
import { SESSION_COOKIE_NAME } from './auth.constants';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ user: PublicUser }> {
    const ua = req.headers['user-agent'];
    const ip = req.ip;
    const { user, sessionId, ttlSeconds } = await this.auth.login(dto.login, dto.password, {
      userAgent: typeof ua === 'string' ? ua : undefined,
      ip,
    });
    setSessionCookie(reply, sessionId, ttlSeconds, this.config);
    return { user };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const cookies = (req as FastifyRequest & { cookies?: Record<string, string | undefined> })
      .cookies;
    const sid = cookies?.[SESSION_COOKIE_NAME];
    await this.auth.logout(sid);
    clearSessionCookie(reply, this.config);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@CurrentUser() session: SessionPayload): Promise<{ user: PublicUser }> {
    const user = await this.auth.getMe(session.userId);
    return { user };
  }

  @Post('change-password')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async changePassword(
    @CurrentUser() session: SessionPayload,
    @SessionId() sid: string,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ user: PublicUser }> {
    const user = await this.auth.changePassword(
      session.userId,
      sid,
      dto.currentPassword,
      dto.newPassword,
    );
    return { user };
  }
}
