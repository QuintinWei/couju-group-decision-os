# 凑局时间协调、单一结果与十城推荐升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用成员真实空闲时间计算共同活动时间，提供去重且有探索性的十城地点卡片，并只输出一个可信的群体最优解。

**Architecture:** 时间协调放在独立纯函数模块，由服务端在成员提交空闲时间时计算并持久化；地点召回使用独立候选池策略完成页码轮换、质量分层、品牌去重与历史排除。现有房间状态机继续负责共享卡池和私人发现，结果页只消费同一份确定性排序。

**Tech Stack:** React 19、TypeScript、Vinext/Vite、Cloudflare D1、Drizzle ORM、高德 Web Service、Node test runner。

**Spec:** `docs/superpowers/specs/2026-08-24-scheduling-single-result-city-expansion-design.md`

## Global Constraints

- 新版迁移清空旧房间和旧成员，不实现旧精确时间房间兼容。
- 日期范围最多 14 天，空闲时间按 30 分钟粒度保存和计算。
- 时段只允许 `morning | afternoon | evening`，支持多选。
- 时长只允许 `120 | 180 | 240 | "240_plus" | null`；`240_plus` 按至少 240 分钟计算，`null` 返回交集窗口并建议可用时长。
- 本期不实现自然语言时间解析。
- 任何客户端响应都不能泄露其他成员的具体空闲区间。
- 每批目标 12 个候选，同批 POI 唯一、同品牌最多一个、餐饮与活动类型不得混用。
- 结果页只展示一个“群体最优解”，DeepSeek 只生成解释，不参与硬过滤和排序。
- 不触碰或提交用户目录 `tmp/`。

---

## File map

- Create `lib/scheduling.ts`: 时间类型、校验、30 分钟窗口和共同时间求解。
- Create `lib/candidate-pool.ts`: 高德页码轮换、质量/探索抽样、品牌去重和排除集合。
- Create `app/api/availability/route.ts`: 成员空闲时间提交和服务端重算入口。
- Create `tests/scheduling-core.test.mjs`: 时间求解的纯函数测试。
- Create `tests/candidate-pool.test.mjs`: 推荐轮换、分层和去重测试。
- Create `tests/availability-api.test.mjs`: 接口校验及隐私约束测试。
- Modify `lib/couju.ts`: 新 `RoomConfig`、十城资料、排序读取已确定时间。
- Modify `db/schema.ts`: 房间时间配置、结果时间和成员空闲时间字段。
- Modify `lib/room-store.ts`: 新字段读写、时间重算和公开 DTO。
- Modify `app/api/rooms/route.ts`: 新建房间参数校验，不再接收精确起止时间。
- Modify `app/api/candidates/route.ts`: 接入候选池策略和高德多页召回。
- Modify `app/page.tsx`: 创建、空闲时间、单一结果三个界面流程。
- Modify `app/globals.css`: 新控件、时间网格和单结果页样式。
- Modify `tests/rendered-html.test.mjs`: 新文案和移除旧入口的回归测试。
- Modify `README.md`: 更新真实能力、时间流程、十城和数据来源说明。

### Task 1: 时间领域模型与求解器

**Files:**
- Create: `lib/scheduling.ts`
- Create: `tests/scheduling-core.test.mjs`
- Modify: `lib/couju.ts`

**Interfaces:**
- Produces `TimePeriod`, `DurationChoice`, `DateRange`, `AvailabilityInterval`, `ResolvedSchedule`, `ScheduleResolution`。
- Produces `validateScheduleConfig(input)` and `resolveGroupSchedule(config, members)`。
- `resolveGroupSchedule` returns `incomplete`, `resolved`, or `partial`; ties sort by attendance descending, preferred-period match descending, total slack descending, date ascending, start time ascending。

- [ ] **Step 1: Write failing schedule tests**

```js
test("resolves the only all-member three-hour window", () => {
  const result = resolveGroupSchedule(
    { dateRange: { start: "2026-08-29", end: "2026-08-30" }, preferredPeriods: ["afternoon"], durationMinutes: 180 },
    [
      { memberId: "a", intervals: [{ startAt: "2026-08-29T13:00:00+08:00", endAt: "2026-08-29T18:00:00+08:00" }] },
      { memberId: "b", intervals: [{ startAt: "2026-08-29T14:00:00+08:00", endAt: "2026-08-29T17:00:00+08:00" }] },
    ],
  );
  assert.equal(result.status, "resolved");
  assert.deepEqual(result.schedule, {
    startAt: "2026-08-29T14:00:00+08:00",
    endAt: "2026-08-29T17:00:00+08:00",
    attendeeIds: ["a", "b"],
  });
});

test("returns a stable maximum-attendance window instead of a fake consensus", () => {
  const result = resolveGroupSchedule(config, mutuallyExclusiveMembers);
  assert.equal(result.status, "partial");
  assert.deepEqual(result.unavailableMemberIds, ["c"]);
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `node --experimental-strip-types --test tests/scheduling-core.test.mjs`
Expected: FAIL because `lib/scheduling.ts` does not exist.

- [ ] **Step 3: Implement canonical periods and validation**

```ts
export const PERIOD_WINDOWS = {
  morning: ["08:00", "12:00"],
  afternoon: ["12:00", "18:00"],
  evening: ["18:00", "24:00"],
} as const;

export type TimePeriod = keyof typeof PERIOD_WINDOWS;
export type DurationChoice = 120 | 180 | 240 | "240_plus" | null;
export type DateRange = { start: string; end: string };
export type AvailabilityInterval = { startAt: string; endAt: string };
export type ResolvedSchedule = { startAt: string; endAt: string; attendeeIds: string[] };
```

Validation must reject ranges over 14 days, non-30-minute boundaries, reverse/overlapping intervals, intervals outside the room range, unsupported periods, and more than 64 normalized intervals per member.

- [ ] **Step 4: Implement deterministic 30-minute solving**

Generate possible starts from normalized member intervals. For `120/180/240`, require the exact duration; for `"240_plus"`, use 240 minutes as the minimum and extend `endAt` to the common interval end; for `null`, choose the best common interval and report its full usable length. Return `incomplete` while any joined member has `availability: null`. Never treat an empty submitted array as unsubmitted.

- [ ] **Step 5: Update `RoomConfig` and run tests**

```ts
export type RoomConfig = {
  city: string;
  kind: "dining" | "activity";
  people: number;
  dateRange: DateRange;
  preferredPeriods: TimePeriod[];
  durationMinutes: DurationChoice;
  resolvedSchedule: ResolvedSchedule | null;
};
```

Run: `node --experimental-strip-types --test tests/scheduling-core.test.mjs tests/couju-core.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/scheduling.ts lib/couju.ts tests/scheduling-core.test.mjs tests/couju-core.test.mjs
git commit -m "feat: resolve group availability into a shared schedule"
```

### Task 2: 十城资料与候选池策略

**Files:**
- Create: `lib/candidate-pool.ts`
- Create: `tests/candidate-pool.test.mjs`
- Modify: `lib/couju.ts`
- Modify: `app/api/candidates/route.ts`

**Interfaces:**
- Produces `amapPagesForBatch(batchIndex): number[]`。
- Produces `selectCandidateBatch(candidates, { excludedIds, batchSize, seed }): Candidate[]`。
- Consumes existing candidate `sourceId`, `rating`, `category`, `name`, and room `kind`。

- [ ] **Step 1: Write failing city and candidate-pool tests**

```js
test("supports all ten launch cities", () => {
  assert.deepEqual(Object.keys(CITY_PROFILES), ["上海", "北京", "广州", "深圳", "杭州", "成都", "南京", "重庆", "苏州", "合肥"]);
});

test("rotates Amap pages and excludes previously seen POIs", () => {
  assert.deepEqual(amapPagesForBatch(0), [1, 2]);
  assert.deepEqual(amapPagesForBatch(1), [3, 4]);
  assert.equal(selectCandidateBatch(pool, { excludedIds: new Set(["poi-1"]), batchSize: 12, seed: "room-2" }).some(x => x.sourceId === "poi-1"), false);
});
```

Also assert 12 unique POIs, at most one normalized brand, seven quality seats plus five exploration seats when enough candidates exist, missing rating remains eligible, and dining/activity category integrity.

- [ ] **Step 2: Run the focused tests and confirm failure**

Run: `node --experimental-strip-types --test tests/candidate-pool.test.mjs`
Expected: FAIL because the module and four city profiles are missing.

- [ ] **Step 3: Add four city profiles**

Add 南京、重庆、苏州、合肥 with Amap city name, center coordinates and representative districts. Keep the existing six entries and the UI order shown in the test.

- [ ] **Step 4: Implement pool selection**

Normalize brands by stripping branch text in `()`, `（）`, `·`, `店`, and common district suffixes. Rank the quality tier by intent match, known rating and completeness; seed-shuffle the exploration tier. Fill 7 quality + 5 exploration, then backfill from the other tier without relaxing POI, brand, room-kind, or exclusion constraints.

- [ ] **Step 5: Connect Amap page rotation**

For each intent, request two pages selected from `[1,2]`, `[3,4]`, `[5,1]`, `[2,3]`, `[4,5]` by `batchIndex % 5`. Merge all responses before selecting 12. Pass current-round IDs, room-history IDs and rejected private-discovery IDs into `excludedIds`. If fewer than 12 valid candidates remain, return the existing explainable shortage response and preserve room state.

- [ ] **Step 6: Run candidate and round tests**

Run: `node --experimental-strip-types --test tests/candidate-pool.test.mjs tests/rounds-core.test.mjs tests/rounds-api.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/candidate-pool.ts lib/couju.ts app/api/candidates/route.ts tests/candidate-pool.test.mjs tests/rounds-core.test.mjs tests/rounds-api.test.mjs
git commit -m "feat: diversify ten-city candidate discovery"
```

### Task 3: Destructive schema migration and availability API

**Files:**
- Modify: `db/schema.ts`
- Create: generated `drizzle/*.sql`
- Modify: `lib/room-store.ts`
- Create: `app/api/availability/route.ts`
- Modify: `app/api/rooms/route.ts`
- Create: `tests/availability-api.test.mjs`
- Modify: `tests/member-submission.test.mjs`

**Interfaces:**
- `StoredMember.availability: AvailabilityInterval[] | null` distinguishes unsubmitted from submitted-empty.
- Produces `submitMemberAvailability({ roomId, memberId, expectedRound, intervals })` and persists `resolvedSchedule` from `resolveGroupSchedule`.
- Room POST consumes `dateRange`, `preferredPeriods`, `durationMinutes`; it rejects legacy `date`, `startTime`, `endTime`.

- [ ] **Step 1: Write failing persistence/API tests**

```js
test("availability submission requires the current round", async () => {
  const response = await submit({ expectedRound: 0, intervals: validIntervals });
  assert.equal(response.status, 409);
});

test("public room data never exposes member intervals", () => {
  const payload = toPublicRoom(storedRoom);
  assert.equal("availability" in payload.members[0], false);
  assert.equal(payload.members[0].availabilitySubmitted, true);
});
```

Also test invalid date bounds, non-half-hour boundaries, resolved persistence after the last member submits, and partial scheduling when no all-member intersection exists.

- [ ] **Step 2: Run tests and confirm failure**

Run: `node --experimental-strip-types --test tests/availability-api.test.mjs tests/member-submission.test.mjs`
Expected: FAIL because the new fields and route do not exist.

- [ ] **Step 3: Change schema and generate migration**

Replace room `date/start_time/end_time` with JSON text columns `schedule_config_json` and nullable `resolved_schedule_json`. Add nullable `availability_json` to members. Generate the migration, then edit it so it first deletes members and rooms and recreates the tables/indexes with the new columns. Do not delete candidate assets or secrets.

Run: `npm run db:generate`
Expected: one new migration and updated Drizzle metadata.

- [ ] **Step 4: Implement store serialization and atomic recomputation**

When an availability submission succeeds, load all room members, solve the schedule, update the submitting member and room result in the same D1 batch/transaction boundary. A newly joined member resets an unlocked resolved schedule to `null`. Once candidate choices exist, preserve the locked schedule and require a late member's submitted interval to contain it.

- [ ] **Step 5: Implement API validation and safe DTOs**

`POST /api/availability` accepts `{ roomId, memberId, expectedRound, intervals }`. Return 400 for invalid intervals, 404 for missing room/member, 409 for stale round or a late member unable to attend the locked schedule, and the public room snapshot on success. Public member output contains only `availabilitySubmitted: boolean`.

- [ ] **Step 6: Run API tests and commit**

Run: `node --experimental-strip-types --test tests/availability-api.test.mjs tests/member-submission.test.mjs tests/round-store-guard.test.mjs`
Expected: PASS.

```bash
git add db/schema.ts drizzle lib/room-store.ts app/api/availability/route.ts app/api/rooms/route.ts tests/availability-api.test.mjs tests/member-submission.test.mjs tests/round-store-guard.test.mjs
git commit -m "feat: persist member availability and resolved schedules"
```

### Task 4: 创建房间和成员时间选择界面

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/globals.css`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes the new Room POST fields and `/api/availability` public snapshot.
- Produces UI stages `create -> join -> availability -> preferences -> cards -> result` without changing existing room-link authorization.

- [ ] **Step 1: Add failing rendered-output assertions**

```js
assert.match(html, /本周末/);
assert.match(html, /上午/);
assert.match(html, /下午/);
assert.match(html, /晚上/);
assert.match(html, /4 小时以上/);
assert.match(html, /不确定/);
assert.doesNotMatch(html, /开始时间/);
assert.doesNotMatch(html, /结束时间/);
```

Also assert the availability stage copy, 30-minute controls, submitted member count, conflict-member panel, and that no natural-language time input is rendered.

- [ ] **Step 2: Run the rendered test and confirm failure**

Run: `node --experimental-strip-types --test tests/rendered-html.test.mjs`
Expected: FAIL on missing new controls and remaining exact-time labels.

- [ ] **Step 3: Replace creation-time controls**

Render date presets `今天 / 本周末 / 下周末 / 自定义`, multiselect chips `上午 / 下午 / 晚上`, and single-select duration `2 小时 / 3 小时 / 4 小时 / 4 小时以上 / 不确定`. Custom dates enforce start ≤ end and a 14-day maximum. The summary reads, for example, `本周末 · 下午或晚上 · 大约 3 小时`.

- [ ] **Step 4: Add the availability grid**

For each selected date, render 30-minute cells within selected periods and an “显示其他时间” expansion. Pointer/keyboard interaction may toggle multiple non-contiguous cells; before submission, merge adjacent cells into `AvailabilityInterval[]`. Preserve unsent selections after a 409 refresh.

- [ ] **Step 5: Render schedule states**

Show `x/y 已提交时间`. For `resolved`, show the exact date/time and enable preferences/cards. For `partial`, show the best window, attendee count and unavailable display names with actions to edit time or invite changes; do not enable final calculation. For `incomplete`, continue waiting without fabricating a time.

- [ ] **Step 6: Run UI tests and commit**

Run: `node --experimental-strip-types --test tests/rendered-html.test.mjs tests/browser-location.test.mjs`
Expected: PASS.

```bash
git add app/page.tsx app/globals.css tests/rendered-html.test.mjs
git commit -m "feat: collect group availability before venue voting"
```

### Task 5: 单一群体最优结果

**Files:**
- Modify: `lib/couju.ts`
- Modify: `app/page.tsx`
- Modify: `tests/couju-core.test.mjs`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes only `RoomConfig.resolvedSchedule` for exact date/time and duration checks.
- Produces one visible top-ranked candidate plus explanation metrics; no alternative strategy selector state remains.

- [ ] **Step 1: Write failing single-result tests**

```js
assert.match(html, /群体最优解/);
assert.doesNotMatch(html, /最佳平衡/);
assert.doesNotMatch(html, /最公平/);
assert.doesNotMatch(html, /最省事/);
```

Add a core test proving veto removes the first candidate and recomputation deterministically promotes the next feasible candidate while keeping fairness/Nash/travel/budget metrics.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `node --experimental-strip-types --test tests/couju-core.test.mjs tests/rendered-html.test.mjs`
Expected: FAIL because three strategy labels still render.

- [ ] **Step 3: Remove strategy tabs and derived alternatives**

Delete `fair`, `easy`, strategy-tab state and same-result notices. Render only `rankGroupCandidates(...)[0]` as “群体最优解”. Keep score, minimum satisfaction, Nash welfare, mean commute, budget pressure, member rows, Amap source, DeepSeek explanation, lock, and veto/recalculate actions.

- [ ] **Step 4: Make unresolved time a hard result guard**

If `resolvedSchedule` is null, do not call final ranking and show the availability state. Duration and operating-hour hints derive only from `resolvedSchedule.startAt/endAt`; no code may fall back to removed room creation times.

- [ ] **Step 5: Run tests and commit**

Run: `node --experimental-strip-types --test tests/couju-core.test.mjs tests/rendered-html.test.mjs`
Expected: PASS.

```bash
git add lib/couju.ts app/page.tsx tests/couju-core.test.mjs tests/rendered-html.test.mjs
git commit -m "feat: present one group-optimal result"
```

### Task 6: Documentation, full verification, push and public deployment

**Files:**
- Modify: `README.md`
- Modify: `.openai/hosting.json` only if the existing Sites configuration requires a build setting change.

**Interfaces:**
- Consumes all prior tasks.
- Produces a verified GitHub `main` and publicly accessible Sites deployment.

- [ ] **Step 1: Update README truthfully**

Document ten cities, Amap as the current place-fact source, DeepSeek as optional explanation/field-extraction support, the group availability workflow, one final group result, Demo fallback behavior, and the absence of Meituan/Dianping integration. Do not claim real-time reservability.

- [ ] **Step 2: Run migration and secret scans**

Run: `git diff --check && rg -n "sk-[A-Za-z0-9_-]{12,}|AMAP.*=[A-Za-z0-9]{12,}" --glob '!tmp/**' --glob '!package-lock.json' .`
Expected: diff check passes and no literal API keys are found in tracked source/docs.

- [ ] **Step 3: Run complete verification**

Run: `npm test`
Expected: build succeeds and every Node test passes.

Run: `npm run lint`
Expected: zero errors.

Run: `git status --short`
Expected: only intended task files plus the pre-existing untracked `tmp/`; do not stage `tmp/`.

- [ ] **Step 4: Commit documentation**

```bash
git add README.md .openai/hosting.json
git commit -m "docs: explain group scheduling and recommendation sources"
```

If `.openai/hosting.json` is unchanged, omit it from `git add`.

- [ ] **Step 5: Push GitHub main**

Run: `git push origin main`
Expected: remote `main` points to the verified local HEAD.

- [ ] **Step 6: Publish through the existing Sites workflow**

Use the repository's configured Sites hosting flow, wait for completion, then open the public URL in a clean session. Verify home creation, public room link access, availability submission, candidate cards, one-result page, and all ten city choices.

- [ ] **Step 7: Record release evidence**

Run: `git rev-parse HEAD && git status --short`
Expected: released commit hash is recorded; worktree is clean except untracked `tmp/`.

## Self-review

- Spec coverage: creation, member availability, common-time resolution, no-intersection behavior, destructive migration, ten cities, Amap rotation/dedup/60:40 mix, one final result, privacy, GitHub and public deployment are each assigned to a task.
- Placeholder scan: no TBD/TODO or unspecified error-handling step remains.
- Type consistency: `preferredPeriods`, `durationMinutes`, `resolvedSchedule`, `availability`, `expectedRound`, and the three solver statuses use the same names across pure functions, store, APIs and UI.
- Scope control: natural-language time parsing and Meituan/Dianping integration are explicitly excluded.
