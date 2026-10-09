/** Seconds. Covers cache hits (ms) up to slow work such as argon2 hashing (~100–300 ms) and timeouts. */
export const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
