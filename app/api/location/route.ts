import { geocodeOrigin, locateFromBrowser } from "../../../lib/amap";
import { SUPPORTED_CITIES, type CityName } from "../../../lib/couju";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return Response.json({ error: "定位请求无效" }, { status: 400 }); }
  const city = SUPPORTED_CITIES.includes(body.city as CityName) ? body.city as CityName : "上海";
  const lat = finiteCoordinate(body.lat, -90, 90);
  const lng = finiteCoordinate(body.lng, -180, 180);
  if (lat !== null && lng !== null) {
    const located = await locateFromBrowser({ lat, lng });
    if (!located) return Response.json({ error: "暂时无法解析当前位置" }, { status: 503 });
    return Response.json({ ...located, mode: "device" });
  }
  const origin = typeof body.origin === "string" ? body.origin.trim().slice(0, 40) : "";
  if (!origin) return Response.json({ error: "请输入地铁站或商圈" }, { status: 400 });
  const location = await geocodeOrigin(city, origin);
  if (!location) return Response.json({ error: `没有识别到“${origin}”，请换成地铁站或商圈全名` }, { status: 422 });
  return Response.json({ location, label: origin, mode: "text" });
}

function finiteCoordinate(value: unknown, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}
