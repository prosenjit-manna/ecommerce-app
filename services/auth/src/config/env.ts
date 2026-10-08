import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

// PEM keys are stored on one line in .env, with "\n" for newlines.
const pem = z
  .string()
  .min(1)
  .transform((v) => v.replace(/\\n/g, '\n'));

const optional = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),

  JWT_ISSUER: z.string().min(1).default('ecommerce-auth'),
  JWT_AUDIENCE: z.string().min(1).default('ecommerce'),
  JWT_KEY_ID: z.string().min(1),
  JWT_PRIVATE_KEY: pem,
  JWT_PUBLIC_KEY: pem,
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  SESSION_MAX_AGE_DAYS: z.coerce.number().int().positive().default(90),

  OTP_PEPPER: z.string().min(32),
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().nonnegative().default(60),
  OTP_MAX_SENDS: z.coerce.number().int().positive().default(5),

  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_SECURE: bool.default(false),
  SMTP_USER: optional,
  SMTP_PASSWORD: optional,
  MAIL_FROM: z.string().min(1),

  GEOIP_DB_PATH: optional,
  RATE_LIMIT_ALLOWLIST: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Fail fast at boot with a readable list of what is missing or wrong.
    console.error('Invalid environment:\n' + z.prettifyError(parsed.error));
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
export const isProd = env.NODE_ENV === 'production';
