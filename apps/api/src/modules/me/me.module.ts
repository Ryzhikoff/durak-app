import { Module } from '@nestjs/common';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { AuthModule } from '../auth/auth.module';
import { CardBacksModule } from '../card-backs/card-backs.module';
import { AvatarController } from './avatar/avatar.controller';
import { AvatarService } from './avatar/avatar.service';
import { CustomCardBackController } from './card-back/custom-card-back.controller';
import { CustomCardBackService } from './card-back/custom-card-back.service';

@Module({
  imports: [AuthModule, CardBacksModule],
  controllers: [MeController, AvatarController, CustomCardBackController],
  providers: [MeService, AvatarService, CustomCardBackService],
})
export class MeModule {}
