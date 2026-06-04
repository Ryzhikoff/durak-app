import { Module } from '@nestjs/common';
import { GamesModule } from '../games/games.module';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  imports: [GamesModule],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
