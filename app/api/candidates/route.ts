import { estimateTravelMinutes, getDemoCandidates, SUPPORTED_CITIES, type Candidate, type CityName, type DecisionKind } from "../../../lib/couju";

export const dynamic = "force-dynamic";

type AmapPoi = {
  id?: string;
  name?: string;
  type?: string;
  address?: string | string[];
  location?: string;
  adname?: string;
  business?: { cost?: string; rating?: string; opentime_today?: string; business_area?: string; tag?: string };
  photos?: Array<{ url?: string }>;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const city = SUPPORTED_CITIES.includes(url.searchParams.get("city") as CityName) ? url.searchParams.get("city") as CityName : "上海";
  const kind: DecisionKind = url.searchParams.get("kind") === "dining" ? "dining" : "activity";
  const key = process.env.AMAP_WEB_SERVICE_KEY;
  if (!key) return demoResponse(city, kind, "未配置高德 Web 服务 Key，当前展示带明确标识的演示候选。", 200);

  try {
    const params = new URLSearchParams({
      key,
      region: `${city}市`,
      city_limit: "true",
      types: kind === "dining" ? "050000" : "080000|110000",
      show_fields: "business,photos",
      page_size: "16",
      page_num: "1",
      output: "json",
    });
    const response = await fetch(`https://restapi.amap.com/v5/place/text?${params}`, { signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new Error(`Amap ${response.status}`);
    const payload = await response.json() as { status?: string; infocode?: string; info?: string; pois?: AmapPoi[] };
    if (payload.status !== "1" || !Array.isArray(payload.pois)) throw new Error(payload.info || payload.infocode || "Amap failed");
    const candidates = payload.pois.flatMap((poi, index) => mapPoi(poi, city, kind, index)).slice(0, 12);
    if (candidates.length < 4) throw new Error("Not enough usable POIs");
    return Response.json({
      candidates,
      meta: { mode: "live", label: "高德地图 POI", fetchedAt: new Date().toISOString(), city, kind, disclaimer: "地点事实来自高德；价格、营业与可订状态仍需到店前确认。" },
    }, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch {
    return demoResponse(city, kind, "高德地点服务暂时不可用，已切换为演示候选。", 200);
  }
}

function mapPoi(poi: AmapPoi, city: CityName, kind: DecisionKind, index: number): Candidate[] {
  if (!poi.id || !poi.name) return [];
  const [lng, lat] = typeof poi.location === "string" ? poi.location.split(",").map(Number) : [NaN, NaN];
  const location = Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : null;
  const price = finiteNumber(poi.business?.cost);
  const rating = finiteNumber(poi.business?.rating);
  const type = poi.type?.split(";").at(-1) || (kind === "dining" ? "餐饮" : "休闲活动");
  const fallbackImages = kind === "dining"
    ? ["food-yunnan", "food-hotpot", "food-sushi", "food-bbq", "food-brunch", "food-vegetarian", "food-dimsum", "food-noodle"]
    : ["activity-kart", "activity-museum", "activity-camp", "activity-boardgame", "activity-escape", "activity-pottery", "activity-brunch", "activity-climb"];
  const photo = poi.photos?.find((item) => typeof item.url === "string")?.url;
  const tag = poi.business?.tag || type;
  const address = Array.isArray(poi.address) ? poi.address.join("") : poi.address || "地址待确认";
  const markerUrl = location
    ? `https://uri.amap.com/marker?position=${location.lng},${location.lat}&name=${encodeURIComponent(poi.name)}&coordinate=gaode&callnative=0`
    : `https://uri.amap.com/search?keyword=${encodeURIComponent(city + poi.name)}`;
  return [{
    id: `amap-${poi.id}`,
    kind,
    city,
    type,
    name: poi.name,
    meta: tag,
    image: photo || `/candidates/${fallbackImages[index % fallbackImages.length]}.jpg`,
    priceValue: price,
    priceLabel: price === null ? "价格待确认" : `¥${Math.round(price)}/人`,
    durationMinutes: kind === "dining" ? 120 : 150,
    durationLabel: kind === "dining" ? "建议预留 2 小时" : "建议预留 2.5 小时",
    address,
    district: poi.adname || poi.business?.business_area || "城区",
    location,
    estimatedTravelMinutes: estimateTravelMinutes(city, location),
    rating,
    openToday: poi.business?.opentime_today || null,
    source: { mode: "live", label: "高德地图 POI", fetchedAt: new Date().toISOString(), providerId: poi.id, url: markerUrl },
    features: {
      indoor: kind === "dining" ? true : null,
      quiet: /安静|书店|美术馆|博物馆/.test(tag + poi.name) ? true : null,
      conversationFriendly: /聚会|朋友|茶|咖啡|餐厅/.test(tag + type) ? true : null,
      nonSpicyAvailable: /不辣|清淡|素食|粤菜|日料/.test(tag + type) ? true : null,
      queueRisk: null,
    },
  }];
}

function demoResponse(city: CityName, kind: DecisionKind, disclaimer: string, status: number) {
  return Response.json({
    candidates: getDemoCandidates(city, kind),
    meta: { mode: "demo", label: "凑局演示候选库", fetchedAt: "2026-08-21T00:00:00.000Z", city, kind, disclaimer },
  }, { status, headers: { "Cache-Control": "no-store" } });
}

function finiteNumber(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
