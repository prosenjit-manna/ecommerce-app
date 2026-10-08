import { isIP } from 'node:net';
import { Reader, type ReaderModel } from '@maxmind/geoip2-node';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export interface GeoLocation {
  countryCode: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
}

let reader: ReaderModel | null = null;

/** Loads the GeoLite2-City database once at boot. Without it, every lookup returns null. */
export async function initGeo(): Promise<void> {
  if (!env.GEOIP_DB_PATH) {
    logger.info('GEOIP_DB_PATH not set; IP geolocation disabled');
    return;
  }
  try {
    reader = await Reader.open(env.GEOIP_DB_PATH);
    logger.info({ path: env.GEOIP_DB_PATH }, 'GeoIP database loaded');
  } catch (err) {
    logger.warn({ err }, 'Could not open GeoIP database; IP geolocation disabled');
  }
}

function isPrivateIp(ip: string): boolean {
  if (ip === '::1' || ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (/^(fc|fd|fe80)/i.test(ip)) return true;
  return false;
}

export function lookupGeo(ip: string | null): GeoLocation | null {
  if (!reader || !ip || !isIP(ip) || isPrivateIp(ip)) return null;
  try {
    const r = reader.city(ip);
    return {
      countryCode: r.country?.isoCode ?? null,
      country: r.country?.names.en ?? null,
      region: r.subdivisions?.[0]?.names.en ?? null,
      city: r.city?.names.en ?? null,
      lat: r.location?.latitude ?? null,
      lon: r.location?.longitude ?? null,
    };
  } catch {
    return null; // AddressNotFoundError etc.
  }
}
