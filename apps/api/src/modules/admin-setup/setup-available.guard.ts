import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Guard for the public `POST /admin/setup` bootstrap endpoint.
 *
 * Runs BEFORE ValidationPipe (guards execute before pipes in the Nest request
 * pipeline). If any active admin already exists in the DB, throws 404 to hide
 * the existence of the endpoint — regardless of whether the request body is
 * valid. This prevents leaking the endpoint via validation error responses.
 */
@Injectable()
export class SetupAvailableGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(_ctx: ExecutionContext): Promise<boolean> {
    const activeAdmins = await this.prisma.user.count({
      where: { isAdmin: true, disabledAt: null },
    });
    if (activeAdmins > 0) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
    }
    return true;
  }
}
