import Taro from "@tarojs/taro";

import type { CityName, GeoPoint } from "../domain/create-room.ts";
import { apiRequest } from "./request.ts";
import { requestDevicePosition } from "./location-core.ts";

type ResolvedOrigin = { location: GeoPoint; label: string; city?: CityName };

export async function resolveOrigin(city: string, origin: string): Promise<ResolvedOrigin> {
  return apiRequest<ResolvedOrigin>("/api/location", {
    method: "POST",
    data: { city, origin },
  });
}

export async function locateCurrentOrigin(): Promise<ResolvedOrigin> {
  const location = await requestDevicePosition(
    () => Taro.getLocation({ type: "gcj02" }),
  );
  return apiRequest<ResolvedOrigin>("/api/location", {
    method: "POST",
    data: { lng: location.lng, lat: location.lat },
  });
}
