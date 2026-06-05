import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
  NICKNAME_PATTERN,
  NICKNAME_PATTERN_MESSAGE,
} from '../../../common/validation/nickname';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MinLength(NICKNAME_MIN_LENGTH)
  @MaxLength(NICKNAME_MAX_LENGTH)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(NICKNAME_PATTERN, { message: NICKNAME_PATTERN_MESSAGE })
  nickname?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  cardBackId?: string;

  @IsOptional()
  @IsBoolean()
  randomCardBack?: boolean;

  @IsOptional()
  @IsIn(['power', 'suit'])
  handSortMode?: 'power' | 'suit';
}
