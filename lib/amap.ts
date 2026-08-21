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

export async function locateFromBrowser(point: GeoPoint): Promise<{ location: GeoPoint; label: string } | null> {
  const key = process.env.AMAP_WEB_SERVICE_KEY;
  if (!key) return null;
  try {
    const converted = await convertGpsPoint(point, key);
    const params = new URLSearchParams({ key, location: `${converted.lng.toFixed(6)},${converted.lat.toFixed(6)}`, radius: "1200", extensions: "all", output: "json" });
    const response = await fetch(`https://restapi.amap.com/v3/geocode/regeo?${params}`, { signal: AbortSignal.timeout(7000) });
    if (!response.ok) return null;
    const payload = await response.json() as {
      status?: string;
      regeocode?: {
        formatted_address?: string;
        addressComponent?: { district?: string | string[]; township?: string | string[] };
        pois?: Array<{ name?: string; distance?: string }>;
      };
    };
    if (payload.status !== "1" || !payload.regeocode) return null;
    const poi = payload.regeocode.pois?.find((item) => item.name)?.name;
    const district = textValue(payload.regeocode.addressComponent?.district);
    const township = textValue(payload.regeocode.addressComponent?.township);
    const label = poi ? `${poi}附近` : [district, township].filter(Boolean).join(" · ") || payload.regeocode.formatted_address || "当前位置附近";
    return { location: { lng: roundCoord(converted.lng), lat: roundCoord(converted.lat) }, label: label.slice(0, 40) };
  } catch { return null; }
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
  return typeof value === "string" ? value : "";
}

function roundCoord(value: number) {
  return Math.round(value * 10_000) / 10_000;
}
