import { CITY_PROFILES, SUPPORTED_CITIES, type CityName } from "./couju";

export type GeoPoint = { lng: number; lat: number };

export async function geocodeOrigin(city: string, origin: string): Promise<GeoPoint | null> {
  const normalizedCity = SUPPORTED_CITIES.includes(city as CityName) ? city as CityName : "上海";
  const key = process.env.AMAP_WEB_SERVICE_KEY;
  if (key) {
    try {
      const params = new URLSearchParams({ key, address: `${city}市${origin}`, city });
      const response = await fetch(`https://restapi.amap.com/v3/geocode/geo?${params}`, { signal: AbortSignal.timeout(7000) });
      if (response.ok) {
        const payload = await response.json() as { status?: string; geocodes?: Array<{ location?: string }> };
        const [lng, lat] = payload.status === "1" && payload.geocodes?.[0]?.location ? payload.geocodes[0].location.split(",").map(Number) : [NaN, NaN];
        if (Number.isFinite(lng) && Number.isFinite(lat)) return { lng, lat };
      }
    } catch {
      // 回退到本地估算。
    }
  }
  return fallbackGeocodeOrigin(normalizedCity, origin);
}

export async function locateFromBrowser(point: GeoPoint): Promise<{ location: GeoPoint; label: string; city: CityName | null }> {
  const detectedCity = findNearestSupportedCity(point);
  const fallback = { location: roundPoint(point), label: detectedCity ? `${detectedCity} · 当前区域（估算）` : "当前位置（估算）", city: detectedCity };
  const key = process.env.AMAP_WEB_SERVICE_KEY;
  if (!key) return fallback;

  let converted: GeoPoint;
  try {
    converted = await convertGpsPoint(point, key);
  } catch {
    return fallback;
  }

  const fallbackForConverted = { ...fallback, location: roundPoint(converted), city: findNearestSupportedCity(converted) ?? detectedCity };
  try {
    const params = new URLSearchParams({ key, location: `${converted.lng.toFixed(6)},${converted.lat.toFixed(6)}`, radius: "1200", extensions: "all", output: "json" });
    const response = await fetch(`https://restapi.amap.com/v3/geocode/regeo?${params}`, { signal: AbortSignal.timeout(7000) });
    if (!response.ok) return fallbackForConverted;
    const payload = await response.json() as {
      status?: string;
      regeocode?: {
        formatted_address?: string;
        addressComponent?: { city?: string | string[]; province?: string | string[]; district?: string | string[]; township?: string | string[] };
        pois?: Array<{ name?: string; distance?: string }>;
      };
    };
    if (payload.status !== "1" || !payload.regeocode) return fallbackForConverted;
    const components = payload.regeocode.addressComponent;
    const poi = payload.regeocode.pois?.find((item) => item.name)?.name;
    const district = textValue(components?.district);
    const township = textValue(components?.township);
    const label = poi || [district, township].filter(Boolean).join(" · ") || payload.regeocode.formatted_address || fallback.label;
    const city = findSupportedCity([components?.city, components?.province, components?.district]) ?? fallbackForConverted.city;
    return { location: fallbackForConverted.location, label: label.slice(0, 40), city };
  } catch {
    return fallbackForConverted;
  }
}

function findNearestSupportedCity(point: GeoPoint): CityName | null {
  let nearestCity: CityName | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const city of SUPPORTED_CITIES) {
    const [centerLng, centerLat] = CITY_PROFILES[city].center;
    const distance = haversineKm(point.lat, point.lng, centerLat, centerLng);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestCity = city;
    }
  }
  return nearestDistance <= 220 ? nearestCity : null;
}

function fallbackGeocodeOrigin(city: CityName, origin: string): GeoPoint {
  const profile = CITY_PROFILES[city];
  const seed = hashString(`${city}:${normalizeOrigin(origin)}`);
  const angle = (seed % 3600) / 3600 * Math.PI * 2;
  const usesDistrict = profile.districts.some((district) => origin.includes(district));
  const radiusKm = usesDistrict ? 1.1 + ((seed >>> 12) % 1100) / 1000 : 2.2 + ((seed >>> 12) % 2600) / 1000;
  return pointFromCenter(profile.center, radiusKm, angle);
}

function normalizeOrigin(value: string) {
  return value.trim().replace(/\s+/g, "").replace(/附近/g, "").replace(/地铁站/g, "").replace(/商圈/g, "");
}

function pointFromCenter([centerLng, centerLat]: [number, number], distanceKm: number, angle: number): GeoPoint {
  const latOffset = distanceKm * Math.cos(angle) / 111;
  const lngOffset = distanceKm * Math.sin(angle) / (111 * Math.cos(centerLat * Math.PI / 180));
  return { lng: roundCoord(centerLng + lngOffset), lat: roundCoord(centerLat + latOffset) };
}

function hashString(value: string) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function convertGpsPoint(point: GeoPoint, key: string): Promise<GeoPoint> {
  const params = new URLSearchParams({ key, locations: `${point.lng},${point.lat}`, coordsys: "gps", output: "json" });
  const response = await fetch(`https://restapi.amap.com/v3/assistant/coordinate/convert?${params}`, { signal: AbortSignal.timeout(7000) });
  if (!response.ok) return point;
  const payload = await response.json() as { status?: string; locations?: string };
  const [lng, lat] = payload.status === "1" && payload.locations ? payload.locations.split(",").map(Number) : [NaN, NaN];
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : point;
}

function textValue(value: string | string[] | undefined) {
  return textValues(value).join("");
}

function textValues(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === "string" && item.length > 0);
}

function findSupportedCity(values: Array<string | string[] | undefined>): CityName | null {
  const normalized = values.flatMap(textValues).map((value) => value.replace(/市/g, ""));
  return SUPPORTED_CITIES.find((city) => normalized.some((value) => value === city || value.includes(city))) ?? null;
}

function roundPoint(point: GeoPoint): GeoPoint {
  return { lng: roundCoord(point.lng), lat: roundCoord(point.lat) };
}

function roundCoord(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
