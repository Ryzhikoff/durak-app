import { Body, Controller, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PublicUser } from '../auth/auth.service';
import { SessionPayload } from '../auth/session.service';
import { UpdateMeDto } from './dto/update-me.dto';
import { MeService } from './me.service';

@Controller('me')
@UseGuards(AuthGuard)
export class MeController {
  constructor(private readonly me: MeService) {}

  @Patch()
  async update(
    @CurrentUser() session: SessionPayload,
    @Body() dto: UpdateMeDto,
  ): Promise<{ user: PublicUser }> {
    return this.me.update(session.userId, dto);
  }
}
