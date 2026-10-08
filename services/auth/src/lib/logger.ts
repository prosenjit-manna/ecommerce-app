import { pino } from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'auth' },
  redact: {
    // Never log credentials or tokens, even by accident.
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.newPassword',
      '*.code',
      '*.refreshToken',
      '*.accessToken',
    ],
    censor: '[redacted]',
  },
});
