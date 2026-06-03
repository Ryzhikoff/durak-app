import { Module } from '@nestjs/common';
import { AdminSetupController } from './admin-setup.controller';
import { AdminSetupService } from './admin-setup.service';
import { SetupAvailableGuard } from './setup-available.guard';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [AdminSetupController],
  providers: [AdminSetupService, SetupAvailableGuard],
})
export class AdminSetupModule {}
