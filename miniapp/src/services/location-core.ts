import type { GeoPoint } from "../domain/create-room.ts";

export type DevicePosition = { longitude: number; latitude: number };

/** Keeps permission and timeout failures explicit so pages can retain manual entry. */
export function requestDevicePosition(getPosition: () => Promise<DevicePosition>, timeoutMs = 10_000): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("定位超时，请手动填写出发地")), timeoutMs);
    getPosition().then(
      (position) => {
        clearTimeout(timer);
        if (!Number.isFinite(position.longitude) || !Number.isFinite(position.latitude)) {
          reject(new Error("定位结果无效，请手动填写出发地"));
          return;
        }
        resolve({ lng: position.longitude, lat: position.latitude });
      },
      () => {
        clearTimeout(timer);
        reject(new Error("未授权定位，请手动填写出发地"));
      },
    );
  });
}
