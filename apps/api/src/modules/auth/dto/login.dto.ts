import { IsString, MinLength, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  login!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(200)
  password!: string;
}
