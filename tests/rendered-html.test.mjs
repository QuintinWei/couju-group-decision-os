import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function fetchFromApp(path = "/", init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, init),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Couju product landing page", async () => {
  const response = await fetchFromApp("/", { headers: { accept: "text/html" } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>凑局 Couju — Group Decision OS<\/title>/i);
  assert.match(html, /不是猜一个答案/);
  assert.match(html, /开始创建/);
  assert.match(html, /六城地点已上线/);
  assert.match(html, /上海 · 北京 · 深圳/);
  assert.doesNotMatch(html, /上海首发|Beta|数据模式全程可见/);
  assert.match(html, /food-yunnan\.jpg/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
});
test("keeps provenance, DeepSeek extraction, and deterministic ranking in the product source", async () => {
  const [page, css, packageJson, amap, locationRoute] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../lib/amap.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/location/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(packageJson, /"name": "couju-group-decision-os"/);
  assert.match(page, /\/api\/candidates/);
  assert.match(page, /\/api\/preferences/);
  assert.match(page, /type="date"/);
  assert.match(page, /type="time"/);
  assert.match(page, /rankCandidates/);
  assert.match(page, /规则降级/);
  assert.match(page, /手输地铁站或商圈也会参与通勤计算/);
  assert.match(page, /探索模式 · 按通勤范围召回/);
  assert.match(page, /通勤约/);
  assert.match(page, /text\/calendar/);
  assert.match(amap, /city: CityName \| null/);
  assert.match(amap, /当前位置（估算）/);
  assert.match(locationRoute, /city: located\.city/);
  assert.match(css, /\.form-control/);
  assert.match(css, /\.photo-winner/);

  await access(new URL("../lib/couju.ts", import.meta.url));
  await access(new URL("../app/api/candidates/route.ts", import.meta.url));
  await access(new URL("../app/api/preferences/route.ts", import.meta.url));
  await access(new URL("../.env.example", import.meta.url));
  await access(new URL("../public/candidates/food-yunnan.jpg", import.meta.url));
  await access(new URL("../docs/AI_WORKFLOW.md", import.meta.url));
});

test("candidate endpoint falls back honestly when no Amap key is configured", async () => {
  const response = await fetchFromApp("/api/candidates?city=%E4%B8%8A%E6%B5%B7&kind=dining&commute=%E2%89%A4%2045%20%E5%88%86%E9%92%9F&location=121.47,31.23");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.meta.mode, "demo");
  assert.equal(payload.meta.commuteWindow, "≤ 45 分钟");
  assert.deepEqual(payload.meta.center, { lng: 121.47, lat: 31.23 });
  assert.ok(payload.candidates.length >= 10);
  assert.ok(["东北菜", "川湘菜", "云贵菜", "江西菜", "东南亚菜"].every((type) => payload.candidates.some((candidate) => candidate.type === type)));
  assert.ok(payload.candidates.every((candidate) => candidate.source.mode === "demo"));
});

test("all six cities keep a complete candidate flow", async () => {
  for (const city of ["上海", "北京", "深圳", "杭州", "成都", "广州"]) {
    const response = await fetchFromApp(`/api/candidates?city=${encodeURIComponent(city)}&kind=dining`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.meta.city, city);
    assert.ok(payload.candidates.length >= 4);
    assert.ok(payload.candidates.every((candidate) => candidate.city === city));
  }
});

test("activity discovery keeps categories diverse and supports scenic cards", async () => {
  const first = await fetchFromApp("/api/candidates?city=%E4%B8%8A%E6%B5%B7&kind=activity&strategy=explore&seed=alpha");
  const second = await fetchFromApp("/api/candidates?city=%E4%B8%8A%E6%B5%B7&kind=activity&strategy=explore&seed=beta");
  const focused = await fetchFromApp("/api/candidates?city=%E4%B8%8A%E6%B5%B7&kind=activity&strategy=focused&interests=%E6%99%AF%E7%82%B9");
  const firstPayload = await first.json(); const secondPayload = await second.json(); const focusedPayload = await focused.json();
  const types = new Set(firstPayload.candidates.map((candidate) => candidate.type));
  assert.ok(["头疗按摩", "攀岩", "电影", "陶艺泥塑", "KTV", "拼豆手作", "剧本杀", "麻将棋牌"].every((type) => types.has(type)));
  assert.ok(types.size > 1);
  assert.ok(firstPayload.candidates.some((candidate) => candidate.type === "景点"));
  assert.ok(focusedPayload.candidates.length > 0);
  assert.ok(focusedPayload.candidates.every((candidate) => candidate.type === "景点"));
  assert.notDeepEqual(firstPayload.candidates.map((candidate) => candidate.id), secondPayload.candidates.map((candidate) => candidate.id));
});

test("the UI exposes consent-based location, city sync, and feedback-driven refresh", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /navigator\.geolocation/);
  assert.match(page, /手输地铁站或商圈也会参与通勤计算/);
  assert.match(page, /自动切换到/);
  assert.doesNotMatch(page, /划卡后，换一批会参考你的真实反馈/);
  assert.doesNotMatch(page, /活动不再混入普通景点/);
  assert.doesNotMatch(page, /随机，但不是乱推/);
  assert.match(page, /全城探索/);
  assert.match(page, /候选范围/);
  assert.match(page, /requestBrowserPosition/);
  assert.match(page, /这批没感觉/);
  assert.match(page, /strategy: "learn"/);
});

test("preference endpoint uses dynamic rule extraction when no DeepSeek key is configured", async () => {
  const response = await fetchFromApp("/api/preferences", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note: "人均 100，晚上 7 点前离开，不吃辣", kind: "dining", city: "上海" }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.extraction.mode, "rules");
  assert.ok(payload.extraction.hardConstraints.some((item) => item.type === "max_budget" && item.value === "100"));
  assert.ok(payload.extraction.hardConstraints.some((item) => item.type === "leave_before" && item.value === "19:00"));
  assert.ok(payload.extraction.hardConstraints.some((item) => item.type === "no_spicy"));
});
