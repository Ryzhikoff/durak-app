import { Controller, Get, Param } from '@nestjs/common';
import type { PublicProfile } from '@durak/shared-types';
import { ProfileService } from './profile.service';

@Controller('users')
export class ProfileController {
  constructor(private readonly service: ProfileService) {}

  @Get(':id/profile')
  getProfile(@Param('id') id: string): Promise<PublicProfile> {
    return this.service.getPublicProfile(id);
  }
}
