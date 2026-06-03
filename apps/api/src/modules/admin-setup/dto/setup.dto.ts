import { IsOptional, IsString, MaxLength, MinLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
  NICKNAME_PATTERN,
  NICKNAME_PATTERN_MESSAGE,
} from '../../../common/validation/nickname';

const LOGIN_PATTERN = /^[a-z0-9._-]+$/;

export class SetupAdminDto {
  @IsString()
  @MinLength(3)
  @MaxLength(64)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @Matches(LOGIN_PATTERN, {
    message: 'login may only contain lowercase letters, digits, dot, dash and underscore',
  })
  login!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(200)
  password!: string;

  @IsOptional()
  @IsString()
  @MinLength(NICKNAME_MIN_LENGTH)
  @MaxLength(NICKNAME_MAX_LENGTH)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(NICKNAME_PATTERN, { message: NICKNAME_PATTERN_MESSAGE })
  nickname?: string;
}
