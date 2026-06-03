import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { LobbiesModule } from '../lobbies/lobbies.module';
import { GamesModule } from '../games/games.module';

@Module({
  imports: [LobbiesModule, GamesModule],
  controllers: [HealthController],
})
export class HealthModule {}
