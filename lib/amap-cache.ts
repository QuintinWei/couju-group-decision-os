/**
 * 一次候选请求会按 interests × pages 扇出多次高德调用，而响应此前完全不缓存，
 * 所以同城同类型的重复召回会反复消耗日配额。这里按检索维度缓存上游结果。
 *
 * 缓存值带上真实抓取时间，候选的 source.fetchedAt 用它而不是响应时间，
 * 避免命中缓存时把陈旧的地点事实标成刚刚抓取。
 */

export type CachedPlaceResult<T> = { pois: T[]; fetchedAt: string };
export type AmapCacheKey = { city: string; kind: string; interest: string; page: number };

const CACHE_NAME = "couju-amap-place";
const CACHE_TTL_SECONDS = 6 * 60 * 60;

type CacheLike = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};

/** Workers 提供 Cache API；Node 测试环境没有，直接退回透传。 */
async function openCache(): Promise<CacheLike | null> {
  const storage = (globalThis as { caches?: { open?(name: string): Promise<CacheLike> } }).caches;
  if (typeof storage?.open !== "function") return null;
  try {
    return await storage.open(CACHE_NAME);
  } catch {
    return null;
  }
}

export function amapCacheKeyUrl(key: AmapCacheKey) {
  const url = new URL("https://couju.internal/amap/place");
  url.searchParams.set("city", key.city);
  url.searchParams.set("kind", key.kind);
  url.searchParams.set("interest", key.interest);
  url.searchParams.set("page", String(key.page));
  return url.toString();
}

export async function withAmapCache<T>(
  key: AmapCacheKey,
  load: () => Promise<T[]>,
  now = () => new Date().toISOString(),
): Promise<CachedPlaceResult<T>> {
  const cache = await openCache();
  const request = new Request(amapCacheKeyUrl(key));
  if (cache) {
    try {
      const hit = await cache.match(request);
      if (hit) {
        const cached = await hit.json() as CachedPlaceResult<T>;
        if (Array.isArray(cached?.pois) && cached.pois.length) return cached;
      }
    } catch {
      // 缓存不可读时按未命中处理。
    }
  }

  const result: CachedPlaceResult<T> = { pois: await load(), fetchedAt: now() };
  // 空结果通常是上游失败或限流，缓存它会把故障固化住。
  if (cache && result.pois.length) {
    try {
      await cache.put(request, new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${CACHE_TTL_SECONDS}` },
      }));
    } catch {
      // 写缓存失败不影响本次结果。
    }
  }
  return result;
}
