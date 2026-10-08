import UAParser from 'ua-parser-js';
import type { DeviceSnapshot } from '../db/schema.js';

/** What the mobile/web client reports about itself (GraphQL DeviceInfoInput). */
export interface ClientDeviceInfo {
  platform?: string | null;
  deviceName?: string | null;
  appVersion?: string | null;
  deviceId?: string | null;
}

const clip = (v: string | null | undefined, max = 200) => (v ? v.slice(0, max) : null);

/**
 * Merges the User-Agent header with what the client says about itself.
 * Native apps send a generic UA (e.g. "okhttp/4" or "Expo/..."), so the client-provided fields win.
 */
export function buildDeviceSnapshot(userAgent: string | null, client?: ClientDeviceInfo | null): DeviceSnapshot {
  const ua = new UAParser(userAgent ?? '').getResult();
  const os = [ua.os.name, ua.os.version].filter(Boolean).join(' ') || null;
  const browser = [ua.browser.name, ua.browser.major].filter(Boolean).join(' ') || null;
  const uaDeviceName = [ua.device.vendor, ua.device.model].filter(Boolean).join(' ') || null;
  const platform = client?.platform?.toLowerCase() ?? null;

  let deviceType: string | null = ua.device.type ?? null; // mobile | tablet | console | smarttv | wearable | embedded
  if (!deviceType) {
    if (platform === 'ios' || platform === 'android') deviceType = 'mobile';
    else if (userAgent) deviceType = 'desktop';
  }

  return {
    userAgent: clip(userAgent, 500),
    deviceType,
    // Phones/tablets: "Apple iPhone". Desktops: "Chrome 130 on Mac OS 10.15.7" (vendor/model there is noise).
    deviceName:
      clip(client?.deviceName) ??
      (ua.device.type ? uaDeviceName : null) ??
      (browser && os ? `${browser} on ${os}` : (browser ?? os)),
    os,
    browser,
    clientPlatform: clip(platform, 20) ?? (browser ? 'web' : null),
    appVersion: clip(client?.appVersion, 50),
    clientDeviceId: clip(client?.deviceId, 100),
  };
}
