import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { UserTextReactionsController } from './user-text-reactions.controller';
import { UserTextReactionsService } from './user-text-reactions.service';

/**
 * Bundles the per-user custom text-reactions endpoints under `/api/me/text-
 * reactions`. Exported so the games module can inject the service into the
 * WS gateway's resolve path.
 */
@Module({
  imports: [AuthModule],
  controllers: [UserTextReactionsController],
  providers: [UserTextReactionsService],
  exports: [UserTextReactionsService],
})
export class UserTextReactionsModule {}
