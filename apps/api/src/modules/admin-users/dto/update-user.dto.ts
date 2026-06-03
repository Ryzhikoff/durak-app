import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
  NICKNAME_PATTERN,
  NICKNAME_PATTERN_MESSAGE,
} from '../../../common/validation/nickname';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(NICKNAME_MIN_LENGTH)
  @MaxLength(NICKNAME_MAX_LENGTH)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(NICKNAME_PATTERN, { message: NICKNAME_PATTERN_MESSAGE })
  nickname?: string;

  @IsOptional()
  @IsBoolean()
  isAdmin?: boolean;

  /** true = disable (sets disabledAt=now), false = re-enable (clears disabledAt) */
  @IsOptional()
  @IsBoolean()
  disabled?: boolean;
}
