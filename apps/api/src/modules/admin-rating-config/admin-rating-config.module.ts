import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RatingConfigController } from './rating-config.controller';
import { RatingConfigService } from './rating-config.service';

@Module({
  imports: [AuthModule],
  controllers: [RatingConfigController],
  providers: [RatingConfigService],
  exports: [RatingConfigService],
})
export class AdminRatingConfigModule {}
