import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 chars'),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1')
    .pipe(z.boolean())
    .default('false' as never),
  COOKIE_DOMAIN: z.string().optional(),
  SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 30),

  UPLOADS_DIR: z.string().default('/data/uploads'),
  LOG_LEVEL: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): AppEnv {
  // In test env we provide sensible defaults so unit tests don't need full env wiring.
  if (raw.NODE_ENV === 'test') {
    raw.DATABASE_URL = raw.DATABASE_URL ?? 'postgresql://test:test@localhost:5432/test';
    raw.REDIS_URL = raw.REDIS_URL ?? 'redis://localhost:6379';
    raw.SESSION_SECRET = raw.SESSION_SECRET ?? 'test-session-secret-please-change';
  }
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n  ');
    throw new Error(`Invalid environment configuration:\n  ${issues}`);
  }
  return result.data;
}
