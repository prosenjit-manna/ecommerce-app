import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { AnyFn } from '../../test/helpers/fixtures.js';

// Pretend a GeoLite2 database is configured.
process.env.GEOIP_DB_PATH = '/fake/GeoLite2-City.mmdb';

const city = jest.fn<AnyFn>((ip: string) => {
  if (ip === '8.8.8.8') {
    return {
      country: { isoCode: 'US', names: { en: 'United States' } },
      subdivisions: [{ names: { en: 'California' } }],
      city: { names: { en: 'Mountain View' } },
      location: { latitude: 37.4, longitude: -122.1 },
    };
  }
  throw new Error('AddressNotFoundError');
});
const open = jest.fn<AnyFn>(async () => ({ city }));
jest.unstable_mockModule('@maxmind/geoip2-node', () => ({ Reader: { open } }));

const { initGeo, lookupGeo } = await import('./geo.js');

let openedWith: unknown[] = [];
beforeAll(async () => {
  await initGeo();
  openedWith = open.mock.calls.slice(); // clearMocks resets call history before each test
});

describe('lookupGeo with a GeoIP database', () => {
  it('opens the configured database once', () => {
    expect(openedWith).toEqual([['/fake/GeoLite2-City.mmdb']]);
  });

  it('maps a public IP to city, region, country and coordinates', () => {
    expect(lookupGeo('8.8.8.8')).toEqual({
      countryCode: 'US',
      country: 'United States',
      region: 'California',
      city: 'Mountain View',
      lat: 37.4,
      lon: -122.1,
    });
  });

  it.each(['10.1.2.3', '172.16.0.1', '192.168.1.1', '127.0.0.1', '::1', 'fd00::1', 'fe80::1'])(
    'skips the lookup for the private address %s',
    (ip) => {
      city.mockClear();
      expect(lookupGeo(ip)).toBeNull();
      expect(city).not.toHaveBeenCalled();
    },
  );

  it('returns null for addresses missing from the database', () => {
    expect(lookupGeo('203.0.113.99')).toBeNull();
  });
});
