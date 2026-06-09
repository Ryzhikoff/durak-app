import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminTextReactionsController } from './admin-text-reactions.controller';
import { TextReactionsController } from './text-reactions.controller';
import { AdminTextReactionsService } from './admin-text-reactions.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminTextReactionsController, TextReactionsController],
  providers: [AdminTextReactionsService],
  exports: [AdminTextReactionsService],
})
export class AdminTextReactionsModule {}
