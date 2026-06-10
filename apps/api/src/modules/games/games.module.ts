import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminTextReactionsModule } from '../admin-text-reactions/admin-text-reactions.module';
import { fisherYatesShuffle } from '../../common/shuffle';
import { GamesController } from './games.controller';
import { GamesGateway } from './games.gateway';
import { GamesService } from './games.service';
import { GamesHistoryService } from './games-history.service';
import { GamesPauseService } from './games-pause.service';
import { GamesTurnTimerService } from './games-turn-timer.service';
import { RematchController } from './rematch.controller';
import { RematchService, REMATCH_SHUFFLE_TOKEN } from './rematch.service';

@Module({
  imports: [AuthModule, AdminTextReactionsModule],
  controllers: [GamesController, RematchController],
  providers: [
    GamesService,
    GamesGateway,
    GamesHistoryService,
    GamesPauseService,
    GamesTurnTimerService,
    RematchService,
    // Default crypto-strong Fisher–Yates shuffle for layoutOnRepeat='random'.
    // RematchService accepts an @Optional() override so specs can pin it.
    { provide: REMATCH_SHUFFLE_TOKEN, useValue: fisherYatesShuffle },
  ],
  exports: [
    GamesService,
    GamesHistoryService,
    GamesPauseService,
    GamesTurnTimerService,
    RematchService,
  ],
})
export class GamesModule {}
