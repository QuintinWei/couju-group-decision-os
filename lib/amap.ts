import { SUPPORTED_CITIES, type CityName } from "./couju";

export type GeoPoint = { lng: number; lat: number };

export async function geocodeOrigin(city: string, origin: string): Promise<GeoPoint | null> {
  const key = process.env.AMAP_WEB_SERVICE_KEY;
  if (!key) return null;
  try {
    const params = new URLSearchParams({ key, address: `${city}市${origin}`, city });
    const response = await fetch(`https://restapi.amap.com/v3/geocode/geo?${params}`, { signal: AbortSignal.timeout(7000) });
    if (!response.ok) return null;
    const payload = await response.json() as { status?: string; geocodes?: Array<{ location?: string }> };
    const [lng, lat] = payload.status === "1" && payload.geocodes?.[0]?.location ? payload.geocodes[0].location.split(",").map(Number) : [NaN, NaN];
    return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
  } catch { return null; }
}

export async function locateFromBrowser(point: GeoPoint): Promise<{ location: GeoPoint; label: string; city: CityName | null }> {
  const fallback = { location: roundPoint(point), label: "当前位置附近", city: null as CityName | null };
  const key = process.env.AMAP_WEB_SERVICE_KEY;
  if (!key) return fallback;

  let converted: GeoPoint;
  try {
    converted = await convertGpsPoint(point, key);
  } catch {
    return fallback;
  }

  const fallbackForConverted = { ...fallback, location: roundPoint(converted) };
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
    const label = poi ? `${poi}附近` : [district, township].filter(Boolean).join(" · ") || payload.regeocode.formatted_address || fallback.label;
    const city = findSupportedCity([components?.city, components?.province, components?.district]);
    return { location: fallbackForConverted.location, label: label.slice(0, 40), city };
  } catch {
    return fallbackForConverted;
  }
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
