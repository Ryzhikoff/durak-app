import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminFaceCardsController } from './admin-face-cards.controller';
import { FaceCardsController } from './face-cards.controller';
import { AdminFaceCardsService } from './admin-face-cards.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminFaceCardsController, FaceCardsController],
  providers: [AdminFaceCardsService],
  exports: [AdminFaceCardsService],
})
export class AdminFaceCardsModule {}
