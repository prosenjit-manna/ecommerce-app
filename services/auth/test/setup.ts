// Runs before every test file (before any `await import()` of source code), so
// src/config/env.ts sees a complete, valid environment and never calls process.exit.
import { generateKeyPairSync } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  PORT: '4001',
  DATABASE_URL: 'postgres://test:test@localhost:5432/auth_test',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ISSUER: 'ecommerce-auth',
  JWT_AUDIENCE: 'ecommerce',
  JWT_KEY_ID: 'test-key',
  JWT_PRIVATE_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  JWT_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  ACCESS_TOKEN_TTL_SECONDS: '900',
  REFRESH_TOKEN_TTL_DAYS: '30',
  SESSION_MAX_AGE_DAYS: '90',
  OTP_PEPPER: 'test-pepper-test-pepper-test-pepper-0123',
  OTP_TTL_SECONDS: '600',
  OTP_MAX_ATTEMPTS: '5',
  OTP_RESEND_COOLDOWN_SECONDS: '60',
  OTP_MAX_SENDS: '5',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  MAIL_FROM: 'Test <test@example.com>',
  GEOIP_DB_PATH: '',
  RATE_LIMIT_ALLOWLIST: '',
});
