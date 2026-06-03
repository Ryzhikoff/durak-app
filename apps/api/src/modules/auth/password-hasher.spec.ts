import { describe, it, expect } from 'vitest';
import { PasswordHasher } from './password-hasher';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();

  it('hashes and verifies a password correctly', async () => {
    const hash = await hasher.hash('hunter22');
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await hasher.verify(hash, 'hunter22')).toBe(true);
    expect(await hasher.verify(hash, 'hunter23')).toBe(false);
  });

  it('verify returns false on malformed hash without throwing', async () => {
    expect(await hasher.verify('not-a-hash', 'whatever')).toBe(false);
  });
});
