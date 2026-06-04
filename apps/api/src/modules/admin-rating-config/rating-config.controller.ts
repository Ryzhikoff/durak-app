import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import type { RatingConfig } from '@durak/shared-types';
import { AdminGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionPayload } from '../auth/session.service';
import { RatingConfigService } from './rating-config.service';
import { UpdateRatingConfigDto } from './dto/update-rating-config.dto';

@Controller('admin/rating-config')
@UseGuards(AdminGuard)
export class RatingConfigController {
  constructor(private readonly service: RatingConfigService) {}

  @Get()
  get(): Promise<RatingConfig> {
    return this.service.get();
  }

  @Patch()
  update(
    @Body() dto: UpdateRatingConfigDto,
    @CurrentUser() session: SessionPayload,
  ): Promise<RatingConfig> {
    return this.service.update(
      {
        initialMu: dto.initialMu,
        initialSigma: dto.initialSigma,
        beta: dto.beta,
        tau: dto.tau,
        drawProbability: dto.drawProbability,
      },
      session.userId,
    );
  }
}
