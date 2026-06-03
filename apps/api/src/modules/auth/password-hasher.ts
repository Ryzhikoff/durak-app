import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/**
 * Strategy-pattern friendly password hasher. Currently a single Argon2id
 * implementation; extracted so it can be swapped in tests / future ports.
 */
@Injectable()
export class PasswordHasher {
  private readonly options: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 64 * 1024, // 64 MiB
    timeCost: 3,
    parallelism: 1,
  };

  hash(plain: string): Promise<string> {
    return argon2.hash(plain, this.options);
  }

  verify(hash: string, plain: string): Promise<boolean> {
    return argon2.verify(hash, plain).catch(() => false);
  }
}
