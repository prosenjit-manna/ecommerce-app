import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { lookupGeo, type GeoLocation } from './geo.js';

/** Who is calling, resolved once per request and reused by every resolver. */
export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
  geo: GeoLocation | null;
  requestId: string;
}

declare global {
  namespace Express {
    interface Request {
      clientInfo: ClientInfo;
    }
  }
}

// "::ffff:203.0.113.5" → "203.0.113.5"
const normalizeIp = (ip: string | undefined) => (ip ? ip.replace(/^::ffff:/, '') : null);

/**
 * `req.ip` honours `app.set('trust proxy', n)`: behind n proxies (Apollo Router, ALB) it reads
 * the client address from X-Forwarded-For instead of the proxy's socket address.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const ip = normalizeIp(req.ip);
  const requestId = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
  res.setHeader('x-request-id', requestId);
  req.clientInfo = {
    ip,
    userAgent: req.headers['user-agent'] ?? null,
    geo: lookupGeo(ip),
    requestId,
  };
  next();
}
