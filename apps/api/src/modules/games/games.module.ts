import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GamesController } from './games.controller';
import { GamesGateway } from './games.gateway';
import { GamesService } from './games.service';
import { GamesHistoryService } from './games-history.service';
import { GamesPauseService } from './games-pause.service';

@Module({
  imports: [AuthModule],
  controllers: [GamesController],
  providers: [GamesService, GamesGateway, GamesHistoryService, GamesPauseService],
  exports: [GamesService, GamesHistoryService, GamesPauseService],
})
export class GamesModule {}
