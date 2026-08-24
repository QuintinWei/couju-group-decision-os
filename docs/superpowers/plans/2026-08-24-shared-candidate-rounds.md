# Shared Candidate Rounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a three-round shared candidate flow with member refresh requests, three private rescue cards for all-reject members, one nomination per member, group-feedback learning, and deterministic conflict explanations.

**Architecture:** Keep the current room and member identity model, extend D1 with explicit round state, and put scoring/composition rules in pure functions under `lib/rounds.ts`. A new authenticated `/api/rounds` route owns request, private-discovery, nomination, and atomic advance actions; the client only renders state and asks the server to mutate it.

**Tech Stack:** React 19, TypeScript, vinext/Vite, Cloudflare D1, Drizzle ORM, Node test runner, 高德 Web Service API, DeepSeek only for optional preference extraction.

**Spec:** `docs/superpowers/specs/2026-08-24-shared-candidate-rounds-design.md`

## Global Constraints

- Every round contains exactly 12 shared candidates.
- Private discovery appears only after a member rejects all 12 shared cards; it contains exactly 3 member-private candidates and allows at most 1 nomination.
- A private candidate cannot become a result until it is included in a later shared round and rated by all submitted members.
- A new round always reserves at least 4 slots for unseen-category exploration.
- The room supports at most 3 rounds.
- Only the creator may advance a round, and only after all currently joined members have submitted the current round.
- Candidate generation failure must leave the existing round and submissions intact.
- DeepSeek is never required for authorization, round advancement, feedback aggregation, or conflict diagnosis.
- Preserve old rooms as round 1 with empty history.
- Do not stage, modify, or delete the existing untracked `tmp/` directory.

---

### Task 1: Pure round feedback and composition engine

**Files:**
- Create: `lib/rounds.ts`
- Create: `tests/rounds-core.test.mjs`
- Modify: `lib/couju.ts`

**Interfaces:**
- Consumes: `Candidate`, `Choice`, `StoredMember`-compatible member fields.
- Produces:
  - `aggregateRoundFeedback(candidates, members): RoundFeedback`
  - `buildNextRoundSlots(nominations, learned, exploration): Candidate[]`
  - `canRequestPrivateDiscovery(candidateIds, choices): boolean`
  - `diagnoseRoundConflict(candidates, members, config): ConflictReason[]`

- [ ] **Step 1: Write failing tests for all-reject eligibility and feedback weights**

```js
test("private discovery requires rejecting every shared candidate", () => {
  assert.equal(canRequestPrivateDiscovery(["a", "b"], { a: "no", b: "no" }), true);
  assert.equal(canRequestPrivateDiscovery(["a", "b"], { a: "no", b: "okay" }), false);
  assert.equal(canRequestPrivateDiscovery(["a", "b"], { a: "no" }), false);
});

test("group feedback uses like +2, okay +0.5, no -1.5", () => {
  const feedback = aggregateRoundFeedback(candidates, members);
  assert.equal(feedback.categoryScores.get("陶艺泥塑"), 1);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --experimental-strip-types --test tests/rounds-core.test.mjs`

Expected: FAIL because `lib/rounds.ts` does not exist.

- [ ] **Step 3: Implement minimal pure types and functions**

```ts
export type RoundFeedback = {
  categoryScores: Map<string, number>;
  rejectedCandidateIds: string[];
  seenCandidateIds: string[];
};

const CHOICE_WEIGHT = { like: 2, okay: 0.5, no: -1.5 } as const;

export function canRequestPrivateDiscovery(ids: string[], choices: Record<string, Choice>) {
  return ids.length === 12 && ids.every((id) => choices[id] === "no");
}
```

Implement `aggregateRoundFeedback` without reading UI state or calling external services.

- [ ] **Step 4: Add failing tests for fixed 12-slot composition**

```js
test("next round keeps nominations, fills learned slots, and reserves four exploration cards", () => {
  const result = buildNextRoundSlots(nominations, learned, exploration);
  assert.equal(result.length, 12);
  assert.deepEqual(result.slice(0, nominations.length).map((item) => item.id), nominations.map((item) => item.id));
  assert.equal(result.filter((item) => item.segment === "explore").length, 4);
  assert.equal(new Set(result.map((item) => item.id)).size, 12);
});
```

- [ ] **Step 5: Implement composition and deterministic conflict diagnosis**

Composition order is nominations, learned/compromise, then exactly four exploration candidates; deduplicate by provider ID and fill any nomination gap from learned candidates. Conflict diagnosis must emit typed reasons for `all_rejected`, `commute`, `budget`, `duration`, and `unknown_hard_fact` using the same filters as `rankGroupCandidates`.

- [ ] **Step 6: Run focused and existing core tests**

Run: `node --experimental-strip-types --test tests/rounds-core.test.mjs tests/couju-core.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/rounds.ts lib/couju.ts tests/rounds-core.test.mjs
git commit -m "feat: add shared round feedback engine"
```

### Task 2: Persist round state and private nominations

**Files:**
- Modify: `db/schema.ts`
- Create: generated `drizzle/0002_*.sql`
- Modify: `lib/room-store.ts`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: pure round types from Task 1.
- Produces:
  - `StoredRoom.currentRound: number`
  - `StoredRoom.roundHistory: RoundHistoryEntry[]`
  - `StoredMember.refreshRequestRound: number | null`
  - `StoredMember.privateCandidates: Candidate[]`
  - `StoredMember.nominatedCandidate: Candidate | null`
  - authenticated store functions used by Task 3.

- [ ] **Step 1: Add failing schema/source assertions**

```js
assert.match(schema, /currentRound: integer\("current_round"\).*default\(1\)/s);
assert.match(schema, /roundHistoryJson: text\("round_history_json"\)/);
assert.match(schema, /refreshRequestRound: integer\("refresh_request_round"\)/);
assert.match(schema, /privateCandidatesJson: text\("private_candidates_json"\)/);
assert.match(schema, /nominatedCandidateJson: text\("nominated_candidate_json"\)/);
```

- [ ] **Step 2: Run the source test and verify RED**

Run: `npm run build && node --experimental-strip-types --test tests/rendered-html.test.mjs`

Expected: FAIL on missing round columns.

- [ ] **Step 3: Extend Drizzle schema and generate migration**

```ts
currentRound: integer("current_round").notNull().default(1),
roundHistoryJson: text("round_history_json").notNull().default("[]"),
refreshRequestRound: integer("refresh_request_round"),
privateCandidatesJson: text("private_candidates_json"),
nominatedCandidateJson: text("nominated_candidate_json"),
```

Run: `npm run db:generate`

Inspect the generated SQL and confirm it only adds the five columns with safe defaults.

- [ ] **Step 4: Extend storage mapping and authenticated mutations**

```ts
export async function setRefreshRequest(input: MemberAuth & { requested: boolean; expectedRound: number }): Promise<RoundMutationResult>;
export async function savePrivateCandidates(input: MemberAuth & { expectedRound: number; candidates: Candidate[] }): Promise<RoundMutationResult>;
export async function nominatePrivateCandidate(input: MemberAuth & { expectedRound: number; candidateId: string | null }): Promise<RoundMutationResult>;
export async function advanceStoredRound(input: MemberAuth & { expectedRound: number; candidates: Candidate[]; meta: CandidateMeta; reason: string }): Promise<RoundMutationResult>;
```

`advanceStoredRound` must authenticate the first-created member, re-read the current round, reject stale `expectedRound`, append history, update candidates and round in one `db.batch`, and only then clear current choices/submission/request/private fields. Preserve budget, commute, setting, origin, note, and extraction.

- [ ] **Step 5: Run build and source tests**

Run: `npm run build && node --experimental-strip-types --test tests/rendered-html.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add db/schema.ts drizzle lib/room-store.ts tests/rendered-html.test.mjs
git commit -m "feat: persist shared decision rounds"
```

### Task 3: Authenticated round API and private discovery generation

**Files:**
- Create: `app/api/rounds/route.ts`
- Modify: `app/api/candidates/route.ts`
- Create: `tests/rounds-api.test.mjs`

**Interfaces:**
- Consumes: Task 1 feedback/composition functions and Task 2 store functions.
- Produces: `POST /api/rounds` actions `request`, `private-discovery`, `nominate`, and `advance`.

- [ ] **Step 1: Write failing API validation tests**

```js
test("round actions reject missing member credentials", async () => {
  const response = await fetchFromApp("/api/rounds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "request", roomCode: "ABC123" }),
  });
  assert.equal(response.status, 400);
});

test("candidate endpoint private mode returns three unseen cards", async () => {
  const response = await fetchFromApp("/api/candidates?city=上海&kind=activity&strategy=private&limit=3&exclude=a,b");
  const payload = await response.json();
  assert.equal(payload.candidates.length, 3);
  assert.equal(payload.meta.strategy, "private");
});
```

- [ ] **Step 2: Run API tests and verify RED**

Run: `npm run build && node --experimental-strip-types --test tests/rounds-api.test.mjs`

Expected: FAIL because `/api/rounds` and private strategy do not exist.

- [ ] **Step 3: Implement action parsing and authorization**

Use one route with a discriminated action. Return `400` for malformed input, `403` for invalid member/creator credentials, `409` for stale round or premature advance, `422` when private discovery eligibility is false, and `429` when already at round 3.

- [ ] **Step 4: Add private candidate strategy**

`strategy=private` must require a limit of 3, exclude all current/history/private rejected IDs, prioritize the member's selected setting and unseen categories, and return exactly three candidates when the live or demo pool has enough unique entries. Label metadata `私人发现` or `私人发现 · 演示`.

- [ ] **Step 5: Make advance generate before mutating**

The route loads the room, aggregates all submitted member feedback, collects valid nominations, requests learned and exploration candidates, calls `buildNextRoundSlots`, verifies 12 unique candidates, then calls `advanceStoredRound`. Any fetch/generation error returns without modifying D1.

- [ ] **Step 6: Run API, core, and build tests**

Run: `npm run build && node --experimental-strip-types --test tests/rounds-api.test.mjs tests/rounds-core.test.mjs tests/rendered-html.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/api/rounds/route.ts app/api/candidates/route.ts tests/rounds-api.test.mjs
git commit -m "feat: add authenticated round actions"
```

### Task 4: Member private rescue and nomination UI

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/globals.css`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: `StoredRoom.currentRound`, member private fields, and Task 3 actions.
- Produces: new client stage `private-discovery`; member request/nomination controls.

- [ ] **Step 1: Add failing UI source assertions**

```js
assert.match(page, /仅你可见 · 提名后进入下一轮共享评选/);
assert.match(page, /三张都不合适，跳过/);
assert.match(page, /这批都没感觉，请求换一批/);
assert.match(page, /action: "private-discovery"/);
assert.match(page, /action: "nominate"/);
```

- [ ] **Step 2: Run rendered source test and verify RED**

Run: `npm run build && node --experimental-strip-types --test tests/rendered-html.test.mjs`

Expected: FAIL on missing private discovery UI.

- [ ] **Step 3: Route all-reject members to private discovery**

After the twelfth card, call `canRequestPrivateDiscovery`. Eligible members go to `private-discovery`; other members go to optional details as today. Private cards display the member-specific commute estimate and use mutually exclusive `提名这张` selection.

- [ ] **Step 4: Submit request and nomination state**

The final submit sends current choices first, then `request` when the member explicitly asks for another batch. Private discovery calls the server and stores only returned member-private cards; nomination calls `nominate`. Skipping leaves nomination null but keeps the refresh request.

- [ ] **Step 5: Add accessible styling and responsive layout**

Use actual buttons with `aria-pressed`, clear `仅你可见` badges, a three-card desktop grid, and a one-column mobile layout. Do not reuse the shared swipe component in a way that exposes private cards through room polling.

- [ ] **Step 6: Run build and UI tests**

Run: `npm run build && node --experimental-strip-types --test tests/rendered-html.test.mjs tests/rounds-core.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/page.tsx app/globals.css tests/rendered-html.test.mjs
git commit -m "feat: add private rescue nominations"
```

### Task 5: Room advancement, zero-result recovery, and third-round diagnosis

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/globals.css`
- Modify: `lib/rounds.ts`
- Modify: `tests/rounds-core.test.mjs`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: Task 3 round actions and Task 1 diagnosis.
- Produces: room round status, creator advance confirmation, zero-result recovery, and final conflict panel.

- [ ] **Step 1: Add failing tests for advancement visibility**

```js
assert.match(page, /第 \{room\.currentRound\}\/3 轮/);
assert.match(page, /人请求换一批/);
assert.match(page, /根据全体反馈开启下一轮/);
assert.match(page, /没有交集，换一批继续选/);
assert.match(page, /已经完成三轮探索/);
```

Add pure conflict tests asserting that an all-reject member produces `all_rejected` and a 30-minute member with only 60-minute candidates produces `commute`.

- [ ] **Step 2: Run tests and verify RED**

Run: `node --experimental-strip-types --test tests/rounds-core.test.mjs tests/rendered-html.test.mjs`

Expected: FAIL on missing room/result controls.

- [ ] **Step 3: Implement room status and creator gating**

Show round, submitted count, and request count to everyone. Enable creator advance only when all joined members submitted and `currentRound < 3`. Require a confirmation dialog with copy explaining that constraints and feedback remain while current card choices reset.

- [ ] **Step 4: Replace the old client-side refresh path**

Delete the old `refreshCandidates` behavior that directly sends candidates to `/api/rooms`. Call `/api/rounds` with `action: "advance"` and `expectedRound`; on success refresh the room and enter the room stage. On `409`, refresh without clearing local state.

- [ ] **Step 5: Add zero-result and third-round branches**

For rounds 1–2 with zero ranked candidates, make advance the primary action. On round 3, call `diagnoseRoundConflict`, display at most two highest-impact reasons, and offer `调整我的边界` and `返回房间讨论`; do not render a fourth-round control.

- [ ] **Step 6: Run the full suite**

Run: `npm test`

Expected: all tests pass with a successful production build.

- [ ] **Step 7: Commit**

```bash
git add app/page.tsx app/globals.css lib/rounds.ts tests/rounds-core.test.mjs tests/rendered-html.test.mjs
git commit -m "feat: complete three-round group discovery"
```

### Task 6: End-to-end verification, documentation, GitHub, and public deployment

**Files:**
- Modify: `README.md`
- Modify: `docs/AI_WORKFLOW.md`
- Verify: `.openai/hosting.json`

**Interfaces:**
- Consumes: completed Tasks 1–5.
- Produces: documented, tested, public release using the existing Site project and URL.

- [ ] **Step 1: Update user-facing documentation**

Document the fixed 12-card shared rounds, private rescue eligibility, one nomination, three-round cap, creator-only advance, group-feedback weights, and the fact that DeepSeek remains optional.

- [ ] **Step 2: Verify migration and repository hygiene**

Run: `npm run db:generate`

Expected: no unexpected second migration after the committed schema migration.

Run: `git status --short`

Expected: only planned files are modified; `tmp/` remains untracked and untouched.

- [ ] **Step 3: Run final verification**

Run: `npm test && npm run lint && git diff --check`

Expected: build succeeds, all tests pass, lint exits 0, and diff check is clean.

- [ ] **Step 4: Commit documentation and push GitHub**

```bash
git add README.md docs/AI_WORKFLOW.md
git commit -m "docs: explain shared discovery rounds"
git push origin main
```

- [ ] **Step 5: Publish the exact validated commit**

Follow `sites:sites-hosting`: push the exact HEAD to the existing Site source repository, package the validated `dist/`, save a Site version with the same commit SHA, deploy to the existing public access policy, and poll until `succeeded`.

- [ ] **Step 6: Verify the public flow**

Open `https://couju-demo.quintinwei1314.chatgpt.site/` and verify one creator plus one joined member can submit round 1, request a refresh, trigger private rescue after all-no, nominate one card, and enter a 12-card round 2 without losing budget or commute settings.

- [ ] **Step 7: Final handoff**

Report the public URL, GitHub update, total passing tests, and the remaining fact that card commute values are estimates rather than live route planning.
