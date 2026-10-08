import { describe, expect, it } from '@jest/globals';
import { initGeo, lookupGeo } from './geo.js';

// The test env has no GEOIP_DB_PATH, which is also how local development runs.
describe('lookupGeo without a GeoIP database', () => {
  it('initGeo disables lookups instead of failing', async () => {
    await expect(initGeo()).resolves.toBeUndefined();
  });

  it.each(['8.8.8.8', '127.0.0.1', '::1', '10.0.0.1', 'not-an-ip', null])('returns null for %p', (ip) => {
    expect(lookupGeo(ip)).toBeNull();
  });
});
