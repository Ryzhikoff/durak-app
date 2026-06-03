import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { LobbiesModule } from '../lobbies/lobbies.module';

@Module({
  imports: [LobbiesModule],
  controllers: [HealthController],
})
export class HealthModule {}
