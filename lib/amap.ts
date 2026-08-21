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
