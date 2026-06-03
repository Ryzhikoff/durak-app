import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  currentPassword!: string;

  @IsString()
  @MinLength(6, { message: 'newPassword must be at least 6 characters' })
  @MaxLength(200)
  newPassword!: string;
}
