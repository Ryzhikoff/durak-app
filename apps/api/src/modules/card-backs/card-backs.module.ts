import { Module } from '@nestjs/common';
import { CardBacksController } from './card-backs.controller';
import { CardBacksService } from './card-backs.service';

@Module({
  controllers: [CardBacksController],
  providers: [CardBacksService],
  exports: [CardBacksService],
})
export class CardBacksModule {}
