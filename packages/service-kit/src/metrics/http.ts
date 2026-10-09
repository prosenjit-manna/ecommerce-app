import { performance } from 'node:perf_hooks';
import type { Request, RequestHandler } from 'express';
import { Counter, Histogram, type Registry } from 'prom-client';
import { DURATION_BUCKETS } from './buckets.js';

/**
 * Counts every HTTP response, including the ones Apollo never sees: 429s from rate limiting,
 * 400s from the JSON body parser, REST routes (/health, /ready, JWKS, webhooks) and 404s.
 */
export function createHttpMetrics(registry: Registry): RequestHandler {
  const requests = new Counter({
    name: 'http_requests_total',
    help: 'HTTP responses by method, route and status code',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [registry],
  });
  const duration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route'] as const,
    buckets: DURATION_BUCKETS,
    registers: [registry],
  });

  return (req, res, next) => {
    const start = performance.now();
    res.on('finish', () => {
      const route = routeLabel(req);
      requests.inc({ method: req.method, route, status: String(res.statusCode) });
      duration.observe({ method: req.method, route }, (performance.now() - start) / 1000);
    });
    next();
  };
}

/**
 * The route pattern, never the raw URL: `/users/:id`, not `/users/42`, so the number of series
 * stays fixed. Mounted middleware (`app.use('/graphql', …)`) reports its mount path, and
 * anything no route matched becomes `unmatched`.
 */
export function routeLabel(req: Pick<Request, 'baseUrl' | 'route'>): string {
  const routePath: unknown = req.route?.path;
  if (typeof routePath === 'string') return req.baseUrl + routePath;
  if (req.baseUrl) return req.baseUrl;
  return 'unmatched';
}
