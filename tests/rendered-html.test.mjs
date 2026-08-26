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
  assert.match(html, /十城地点已上线/);
  assert.match(html, /已支持 10 座城市/);
  assert.match(html, /广州、深圳、杭州/);
  assert.doesNotMatch(html, /广深杭成/);
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
  assert.match(page, /开始时间/);
  assert.match(page, /结束时间/);
  assert.match(page, /添加另一段时间/);
  assert.doesNotMatch(page, /每格 30 分钟|slot-grid/);
  assert.match(page, /PERIOD_ORDER/);
  assert.match(page, /rankCandidates/);
  assert.match(page, /规则降级/);
  assert.match(page, /手输地铁站或商圈也会参与通勤计算/);
  assert.match(page, /默认从全城跨类型随机发现/);
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

test("persists explicit shared-decision round fields in the D1 schema", async () => {
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");

  assert.match(schema, /currentRound: integer\("current_round"\).*default\(1\)/s);
  assert.match(schema, /roundHistoryJson: text\("round_history_json"\)/);
  assert.match(schema, /refreshRequestRound: integer\("refresh_request_round"\)/);
  assert.match(schema, /privateCandidatesJson: text\("private_candidates_json"\)/);
  assert.match(schema, /nominatedCandidateJson: text\("nominated_candidate_json"\)/);
});

test("round storage rejects legacy replacement and validates private and shared round payloads", async () => {
  const [roomStore, roomsRoute] = await Promise.all([
    readFile(new URL("../lib/room-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/rooms/route.ts", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(roomsRoute, /export async function PATCH/);
  assert.doesNotMatch(roomStore, /replaceRoomCandidates/);
  assert.match(roomStore, /input\.candidates\.length !== 3/);
  assert.match(roomStore, /hasUniqueProviderIds\(input\.candidates\)/);
  assert.match(roomStore, /input\.candidates\.length !== 12/);
  assert.match(roomStore, /code: "NOT_CREATOR"/);
  assert.match(roomStore, /code: "STALE_ROUND"/);
  assert.match(roomStore, /startedAt: history\.at\(-1\)\?\.endedAt \?\? room\.created_at/);
  assert.match(roomStore, /budget_label|commute_label|origin_lng|extraction_json/);
  assert.match(roomStore, /private_candidates_json, nominated_candidate_json, submitted_at FROM members/);
  assert.match(roomStore, /privateCandidates: safeJson<Candidate\[\]>/);
  assert.doesNotMatch(roomStore, /UPDATE members[^"]*round_history_json = \?/);
});

test("mobile H5 keeps primary actions reachable above the safe area", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /100dvh/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /touch-action:manipulation/);
  assert.match(css, /@media\(max-width:580px\).*\.zero-result-actions \.full-dark-button\{width:100%/s);
});

test("zero-result ranking does not call the AI explanation endpoint", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(top\.length > 0\).*fetch\("\/api\/explain"/s);
});

test("room refresh uses the latest identity without stale polling closures", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const refreshRoom = useCallback/);
  assert.match(page, /\[roomCode, stage, refreshRoom\]/);
});

test("candidate endpoint keeps a citywide pool and leaves commute limits to member ranking", async () => {
  const base = "/api/candidates?city=%E4%B8%8A%E6%B5%B7&kind=dining&location=121.47,31.23&seed=citywide-test";
  const [response, restrictedResponse] = await Promise.all([
    fetchFromApp(base),
    fetchFromApp(`${base}&commute=${encodeURIComponent("≤ 30 分钟")}`),
  ]);
  assert.equal(response.status, 200);
  assert.equal(restrictedResponse.status, 200);
  const payload = await response.json();
  const restrictedPayload = await restrictedResponse.json();
  assert.equal(payload.meta.mode, "demo");
  assert.equal(payload.meta.commuteWindow, undefined);
  assert.deepEqual(payload.meta.center, { lng: 121.47, lat: 31.23 });
  assert.ok(payload.candidates.length >= 10);
  assert.deepEqual(restrictedPayload.candidates.map((candidate) => candidate.id), payload.candidates.map((candidate) => candidate.id));
  assert.ok(["东北菜", "川湘菜", "云贵菜", "江西菜", "东南亚菜"].every((type) => payload.candidates.some((candidate) => candidate.type === type)));
  assert.ok(payload.candidates.every((candidate) => candidate.source.mode === "demo"));
});

test("all ten cities keep a complete candidate flow", async () => {
  for (const city of ["上海", "北京", "广州", "深圳", "杭州", "成都", "南京", "重庆", "苏州", "合肥"]) {
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
  assert.match(page, /全城召回/);
  assert.doesNotMatch(page, /<legend>候选范围<\/legend>/);
  assert.match(page, /requestBrowserPosition/);
  assert.doesNotMatch(page, /fetch\("\/api\/rooms", \{ method: "PATCH"/);
  assert.doesNotMatch(page, /refreshCandidates/);
  assert.doesNotMatch(page, /结果不满意，换一批重新决策/);
  assert.match(page, /先设定你的选择边界/);
  assert.match(page, /30 分钟.*60 分钟.*1\.5 小时.*不限/);
  assert.match(page, /没有额外要求也可以直接提交/);
  assert.doesNotMatch(page, /setSelectedStrategy/);
  assert.doesNotMatch(page, /本轮三种策略得出同一方案/);
  assert.match(page, /群体最优解/);
  assert.match(page, /onLock\(selected\)/);
  assert.doesNotMatch(page, /strategy: "learn"/);
});

test("the starting-boundary screen surfaces intersection failures instead of looking stuck", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /PreferenceSetupScreen[^]*error=\{roomError\}/);
  assert.match(page, /props\.error && <p className="parse-error" role="alert">/);
});

test("the rejection reason sheet stays compact on desktop and mobile", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.rejection-sheet\{[^}]*width:min\(calc\(100% - 24px\),380px\)/);
  assert.doesNotMatch(css, /@media\(max-width:420px\)\{\.rejection-sheet>div:not\(\.other-reason\)\{grid-template-columns:1fr\}/);
});

test("the UI keeps private rescue cards separate from the shared round", async () => {
  const [page, css, roomsRoute] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/api/rooms/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /仅你可见 · 提名后进入下一轮共享评选/);
  assert.match(page, /三张都不合适，跳过/);
  assert.match(page, /这批都没感觉，请求换一批/);
  assert.match(page, /privateDiscoveryRequestPlan/);
  assert.match(page, /privateNominationAction/);
  assert.match(page, /aria-pressed/);
  assert.match(css, /\.private-card-grid/);
  assert.match(css, /@media\(max-width:760px\).*\.private-card-grid\{grid-template-columns:1fr/s);
  assert.match(roomsRoute, /toJoinRoom\(room\)/);
  assert.match(roomsRoute, /toParticipantRoom\(room, memberId\)/);
});

test("the room flow exposes round-aware recovery only after a shared round is complete", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /第 \{room\.currentRound\}\/3 轮/);
  assert.match(page, /人请求换一批/);
  assert.match(page, /根据全体反馈开启下一轮/);
  assert.match(page, /没有交集，先补充每个人的发现/);
  assert.match(page, /查看我的 3 张私人发现卡/);
  assert.match(page, /张反馈学习 · 4 张新类型探索/);
  assert.match(page, /已经完成三轮探索/);
  assert.match(page, /确认开启下一轮/);
  assert.match(page, /调整我的边界/);
  assert.match(page, /返回房间讨论/);
  assert.match(css, /\.round-status-card/);
  assert.match(css, /\.conflict-panel/);
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
