import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionPayload } from '../auth/session.service';
import { AdminUsersService } from './admin-users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ListUsersQueryDto } from './dto/list-users.dto';

@Controller('admin/users')
@UseGuards(AdminGuard)
export class AdminUsersController {
  constructor(private readonly service: AdminUsersService) {}

  @Get()
  list(@Query() q: ListUsersQueryDto) {
    return this.service.list({
      search: q.search,
      page: q.page ?? 1,
      limit: q.limit ?? 20,
    });
  }

  @Post()
  @HttpCode(201)
  create(@Body() dto: CreateUserDto) {
    return this.service.create({
      login: dto.login,
      password: dto.password,
      nickname: dto.nickname,
      isAdmin: dto.isAdmin,
    });
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() session: SessionPayload,
  ) {
    return this.service.update(id, session.userId, dto);
  }

  @Post(':id/reset-password')
  @HttpCode(204)
  async resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto): Promise<void> {
    await this.service.resetPassword(id, dto.newPassword);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() session: SessionPayload): Promise<void> {
    await this.service.remove(id, session.userId);
  }
}
