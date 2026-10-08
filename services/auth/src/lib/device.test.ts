import { describe, expect, it } from '@jest/globals';
import { buildDeviceSnapshot } from './device.js';

const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

describe('buildDeviceSnapshot', () => {
  it('describes a desktop browser as "<browser> on <os>"', () => {
    const d = buildDeviceSnapshot(CHROME_MAC);
    expect(d).toMatchObject({ deviceType: 'desktop', browser: 'Chrome 130', clientPlatform: 'web' });
    expect(d.os).toContain('Mac OS');
    expect(d.deviceName).toBe(`Chrome 130 on ${d.os}`);
  });

  it('uses vendor + model for phones', () => {
    const d = buildDeviceSnapshot(SAFARI_IPHONE);
    expect(d.deviceType).toBe('mobile');
    expect(d.deviceName).toBe('Apple iPhone');
  });

  it('prefers what a native app reports over its generic User-Agent', () => {
    const d = buildDeviceSnapshot('okhttp/4.12.0', {
      platform: 'Android',
      deviceName: 'Pixel 9',
      appVersion: '2.3.0',
      deviceId: 'install-123',
    });
    expect(d).toMatchObject({
      deviceType: 'mobile',
      deviceName: 'Pixel 9',
      clientPlatform: 'android',
      appVersion: '2.3.0',
      clientDeviceId: 'install-123',
    });
  });

  it('handles a missing User-Agent', () => {
    expect(buildDeviceSnapshot(null)).toMatchObject({ userAgent: null, deviceType: null, deviceName: null });
  });

  it('truncates oversized client values', () => {
    const d = buildDeviceSnapshot(null, { deviceName: 'x'.repeat(500), deviceId: 'y'.repeat(500) });
    expect(d.deviceName).toHaveLength(200);
    expect(d.clientDeviceId).toHaveLength(100);
  });
});
