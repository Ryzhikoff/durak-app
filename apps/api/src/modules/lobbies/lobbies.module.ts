import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GamesModule } from '../games/games.module';
import { LobbiesController } from './lobbies.controller';
import { LobbiesGateway } from './lobbies.gateway';
import { LobbiesService } from './lobbies.service';

@Module({
  imports: [AuthModule, GamesModule],
  controllers: [LobbiesController],
  providers: [LobbiesService, LobbiesGateway],
  exports: [LobbiesService],
})
export class LobbiesModule {}
