import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AdminSetupService } from './admin-setup.service';
import { SetupAdminDto } from './dto/setup.dto';
import { SetupAvailableGuard } from './setup-available.guard';
import { AuthService, PublicUser } from '../auth/auth.service';
import { SessionService } from '../auth/session.service';
import { setSessionCookie } from '../auth/cookie.util';

@Controller('admin/setup')
export class AdminSetupController {
  constructor(
    private readonly service: AdminSetupService,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly config: ConfigService,
  ) {}

  @Get('status')
  @HttpCode(200)
  async status(): Promise<{ available: boolean }> {
    return { available: await this.service.isAvailable() };
  }

  @Post()
  @HttpCode(201)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(SetupAvailableGuard)
  async setup(
    @Body() dto: SetupAdminDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ user: PublicUser }> {
    // Double-check existence (the service also checks). Throw 404 to hide endpoint.
    if (!(await this.service.isAvailable())) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
    }
    const user = await this.service.createFirstAdmin({
      login: dto.login,
      password: dto.password,
      nickname: dto.nickname,
    });

    const ua = req.headers['user-agent'];
    const { id: sessionId, ttlSeconds } = await this.sessions.create({
      userId: user.id,
      isAdmin: true,
      mustChangePassword: false,
      userAgent: typeof ua === 'string' ? ua : undefined,
      ip: req.ip,
    });
    setSessionCookie(reply, sessionId, ttlSeconds, this.config);
    return { user: this.auth.toPublicUser(user) };
  }
}
