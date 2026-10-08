import { Redis } from 'ioredis';
import { env } from './config/env.js';

export const redis = new Redis(env.REDIS_URL, {
  // rate-limiter-flexible recommends failing fast instead of queueing commands while offline.
  enableOfflineQueue: false,
  maxRetriesPerRequest: 2,
});
