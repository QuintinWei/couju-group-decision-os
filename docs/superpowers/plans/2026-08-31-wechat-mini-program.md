# 凑局微信小程序 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一套可在微信开发者工具中完整体验的凑局小程序，支持静默微信登录、自动昵称、吃饭与玩乐双流程、多人决策、私人发现卡和结果页，同时保持现有 H5 正常运行。

**Architecture:** 在同一仓库新增独立的 Taro 4 小程序工作区，通过统一请求层调用现有 Cloudflare API。服务端新增最小微信用户体系，用 OpenID 识别用户、签发凑局 access token，并把小程序用户关联到现有房间成员；现有 `roomCode + memberId + memberToken` 权限边界继续保留。

**Tech Stack:** Taro 4.2.1、React 18.3.1、TypeScript、Cloudflare Workers、D1、Drizzle ORM、Node test runner、微信小程序 AppID `wx7162630074a237b6`

**Spec:** `docs/superpowers/specs/2026-08-31-wechat-mini-program-design.md`

## Global Constraints

- 现有 H5 不要求微信登录，所有现有页面和 API 调用保持兼容。
- AppID 固定为 `wx7162630074a237b6`。
- `WECHAT_APP_SECRET` 和 `WECHAT_TOKEN_SECRET` 只存在于服务端环境变量，不写入 Git 或小程序包。
- 静默登录只能取得 OpenID，不能声称自动取得真实微信昵称。
- 首次用户无需填写昵称，服务端生成稳定且不重复的“微信用户 XXXX”。
- 真实微信昵称仅通过用户主动操作 `input type="nickname"` 更新。
- 小程序不保存头像，不引入文件上传和内容审核链路。
- 分享路径只携带房间码，不携带 access token、memberToken 或 OpenID。
- 小程序成员仍受现有目标人数、时间交集、预算、通勤、轮次和私人卡规则约束。
- 每个任务完成后运行该任务测试；最终必须运行 `npm test` 和 `npm run miniapp:build`。

---

## File Map

### 服务端新增

- `lib/wechat-auth.ts`：微信 code 交换、自动昵称、access token 签发与验证的纯函数。
- `lib/user-store.ts`：D1 用户创建、读取、昵称更新和成员身份恢复。
- `lib/request-user.ts`：解析 Bearer token 并返回当前凑局用户。
- `app/api/auth/wechat/route.ts`：小程序登录接口。
- `app/api/users/profile/route.ts`：读取和更新当前昵称。
- `tests/wechat-auth.test.mjs`：认证纯函数测试。
- `tests/wechat-membership.test.mjs`：H5 兼容、用户关联和身份恢复测试。

### 服务端修改

- `db/schema.ts`：新增 `users` 表和 `members.userId`。
- `drizzle/0007_add_wechat_users.sql`：D1 数据迁移。
- `lib/room-store.ts`：创建、加入和恢复成员时关联 userId。
- `app/api/rooms/route.ts`：小程序创建房间时使用登录用户昵称。
- `app/api/members/route.ts`：小程序加入与恢复成员身份。
- `.env.example`：记录服务端微信密钥变量名。

### 小程序新增

- `miniapp/package.json`：Taro 依赖和构建脚本。
- `miniapp/project.config.json`：微信开发者工具项目配置。
- `miniapp/config/index.ts`、`miniapp/config/dev.ts`、`miniapp/config/prod.ts`：Taro 与 API 地址配置。
- `miniapp/src/app.ts`、`miniapp/src/app.config.ts`、`miniapp/src/app.scss`：小程序入口和全局视觉变量。
- `miniapp/src/types/api.ts`：与服务端一致的 DTO。
- `miniapp/src/services/request.ts`：统一请求、超时和错误转换。
- `miniapp/src/services/auth.ts`、`rooms.ts`、`rounds.ts`、`location.ts`：按业务拆分的 API 调用。
- `miniapp/src/store/session.ts`：登录态和房间成员身份持久化。
- `miniapp/src/domain/`：页面可复用的纯状态转换和表单验证。
- `miniapp/src/components/`：品牌头部、主按钮、状态视图、候选卡、不喜欢原因面板。
- `miniapp/src/pages/home/`、`create/`、`room/`、`availability/`、`constraints/`、`swipe/`、`discovery/`、`result/`：一期八个页面。

### 根目录修改

- `package.json`、`package-lock.json`：登记 npm workspace 和小程序命令。
- `README.md`：增加小程序开发者工具运行说明，只描述已完成能力。
- `tests/miniapp-*.test.mjs`：小程序纯逻辑和源码契约测试。

---

### Task 1: 微信认证纯函数与安全边界

**Files:**
- Create: `lib/wechat-auth.ts`
- Create: `tests/wechat-auth.test.mjs`

**Interfaces:**
- Produces: `exchangeWechatCode(code, config, fetchImpl)` → `Promise<{ openid: string }>`
- Produces: `createAccessToken(userId, issuedAtSeconds, secret)` → `Promise<string>`
- Produces: `verifyAccessToken(token, nowSeconds, secret)` → `Promise<{ userId: string } | null>`
- Produces: `automaticNickname(userId)` → `string`

- [ ] **Step 1: Write failing authentication tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  automaticNickname,
  createAccessToken,
  exchangeWechatCode,
  verifyAccessToken,
} from "../lib/wechat-auth.ts";

test("wechat code is exchanged without exposing the app secret", async () => {
  let requested = "";
  const result = await exchangeWechatCode("one-use-code", {
    appId: "wx7162630074a237b6",
    appSecret: "server-secret",
  }, async (url) => {
    requested = String(url);
    return Response.json({ openid: "openid-1", session_key: "never-return-this" });
  });
  assert.equal(result.openid, "openid-1");
  assert.match(requested, /js_code=one-use-code/);
  assert.deepEqual(Object.keys(result), ["openid"]);
});

test("signed access tokens reject tampering and expiry", async () => {
  const token = await createAccessToken("user-1", 1_000, "token-secret");
  assert.deepEqual(await verifyAccessToken(token, 1_100, "token-secret"), { userId: "user-1" });
  assert.equal(await verifyAccessToken(`${token}x`, 1_100, "token-secret"), null);
  assert.equal(await verifyAccessToken(token, 1_000 + 30 * 24 * 60 * 60 + 1, "token-secret"), null);
});

test("automatic nickname is stable and contains no openid", () => {
  assert.equal(automaticNickname("user-123"), automaticNickname("user-123"));
  assert.match(automaticNickname("user-123"), /^微信用户 [A-Z0-9]{4}$/);
  assert.doesNotMatch(automaticNickname("user-123"), /user-123/);
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `node --experimental-strip-types --test tests/wechat-auth.test.mjs`  
Expected: FAIL because `lib/wechat-auth.ts` does not exist.

- [ ] **Step 3: Add the minimal pure implementation**

Use Web Crypto HMAC-SHA256 and base64url; token payload is exactly `{ sub, iat, exp }`, with `exp = iat + 2_592_000`. `exchangeWechatCode` must reject an empty code, non-2xx response, WeChat `errcode`, or missing OpenID, and must return only `{ openid }`.

```ts
export const ACCESS_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export type WechatExchangeConfig = { appId: string; appSecret: string };

export async function exchangeWechatCode(
  code: string,
  config: WechatExchangeConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ openid: string }> {
  if (!code.trim()) throw new Error("INVALID_WECHAT_CODE");
  const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
  url.search = new URLSearchParams({
    appid: config.appId,
    secret: config.appSecret,
    js_code: code,
    grant_type: "authorization_code",
  }).toString();
  const response = await fetchImpl(url);
  const payload = await response.json() as { openid?: string; errcode?: number };
  if (!response.ok || payload.errcode || !payload.openid) throw new Error("WECHAT_LOGIN_FAILED");
  return { openid: payload.openid };
}
```

Keep the encoder, timing-safe signature comparison, nickname hash and payload validation private to this file.

- [ ] **Step 4: Run the focused tests**

Run: `node --experimental-strip-types --test tests/wechat-auth.test.mjs`  
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/wechat-auth.ts tests/wechat-auth.test.mjs
git commit -m "feat: add secure WeChat auth primitives"
```

---

### Task 2: D1 用户、登录接口与昵称接口

**Files:**
- Modify: `db/schema.ts`
- Create: `drizzle/0007_add_wechat_users.sql`
- Create: `lib/user-store.ts`
- Create: `lib/request-user.ts`
- Create: `app/api/auth/wechat/route.ts`
- Create: `app/api/users/profile/route.ts`
- Modify: `.env.example`
- Create: `tests/wechat-user-api.test.mjs`

**Interfaces:**
- Consumes: Task 1 token and code functions.
- Produces: `findOrCreateWechatUser(openid)` → `Promise<WechatUser>`
- Produces: `authenticateRequestUser(request)` → `Promise<WechatUser | null>`
- Produces: `POST /api/auth/wechat` body `{ code }`
- Produces: `GET/PATCH /api/users/profile`

- [ ] **Step 1: Write failing schema and route-contract tests**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("wechat users are persisted without exposing secrets", async () => {
  const [schema, migration, loginRoute, profileRoute, envExample] = await Promise.all([
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0007_add_wechat_users.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/wechat/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/users/profile/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.match(schema, /users = sqliteTable\("users"/);
  assert.match(schema, /openid: text\("openid"\).*unique/s);
  assert.match(schema, /userId: text\("user_id"\)/);
  assert.match(migration, /CREATE TABLE `users`/);
  assert.match(loginRoute, /exchangeWechatCode/);
  assert.match(loginRoute, /WECHAT_APP_SECRET/);
  assert.doesNotMatch(loginRoute, /session_key.*Response\.json/s);
  assert.match(profileRoute, /authenticateRequestUser/);
  assert.match(envExample, /WECHAT_APP_SECRET=/);
  assert.match(envExample, /WECHAT_TOKEN_SECRET=/);
});
```

- [ ] **Step 2: Verify the contract test fails**

Run: `node --experimental-strip-types --test tests/wechat-user-api.test.mjs`  
Expected: FAIL on the missing migration or route.

- [ ] **Step 3: Add schema and exact migration**

Add a `users` table with `id`, unique `openid`, `nickname`, `createdAt`, and `updatedAt`. Add nullable indexed `userId` to members so current H5 rows remain valid.

```sql
CREATE TABLE `users` (
  `id` text PRIMARY KEY NOT NULL,
  `openid` text NOT NULL,
  `nickname` text NOT NULL,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
CREATE UNIQUE INDEX `users_openid_unique` ON `users` (`openid`);
ALTER TABLE `members` ADD `user_id` text REFERENCES users(`id`);
CREATE INDEX `members_user_id_idx` ON `members` (`user_id`);
```

- [ ] **Step 4: Add user storage and request authentication**

`findOrCreateWechatUser` must use `INSERT ... ON CONFLICT(openid) DO NOTHING`, then select the row, so concurrent first logins cannot create duplicates. `updateWechatNickname` accepts 1–18 trimmed characters and strips `<` and `>`.

`authenticateRequestUser` must parse `Authorization: Bearer <token>`, verify it with `WECHAT_TOKEN_SECRET`, and select the user by id. A missing or invalid token returns `null`; the function never trusts a client-supplied user id.

- [ ] **Step 5: Add login and profile routes**

The login route returns this exact public shape:

```ts
type LoginResponse = {
  accessToken: string;
  user: { id: string; nickname: string };
};
```

Responses: `400` invalid body/code, `503` missing server configuration or WeChat failure, `200` success. Profile GET/PATCH requires Bearer auth, returns `401` when invalid, and PATCH accepts `{ nickname }` only.

- [ ] **Step 6: Document secret names and run tests**

Append to `.env.example` without values:

```dotenv
WECHAT_APP_ID=wx7162630074a237b6
WECHAT_APP_SECRET=
WECHAT_TOKEN_SECRET=
```

Run: `node --experimental-strip-types --test tests/wechat-auth.test.mjs tests/wechat-user-api.test.mjs`  
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add db/schema.ts drizzle/0007_add_wechat_users.sql lib/user-store.ts lib/request-user.ts app/api/auth/wechat/route.ts app/api/users/profile/route.ts .env.example tests/wechat-user-api.test.mjs
git commit -m "feat: add WeChat user sessions"
```

---

### Task 3: 将登录用户关联到房间成员且保持 H5 兼容

**Files:**
- Modify: `lib/room-store.ts`
- Modify: `app/api/rooms/route.ts`
- Modify: `app/api/members/route.ts`
- Create: `tests/wechat-membership.test.mjs`

**Interfaces:**
- Consumes: `authenticateRequestUser(request)` from Task 2.
- Changes: `createStoredRoom` and `joinStoredRoom` accept optional `userId`.
- Produces: `restoreStoredMembership(roomCode, userId)` → rotated `{ memberId, memberToken } | null`.

- [ ] **Step 1: Write failing compatibility tests**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("miniapp membership binds users while H5 remains anonymous-compatible", async () => {
  const [store, rooms, members] = await Promise.all([
    readFile(new URL("../lib/room-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/rooms/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/members/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(store, /userId\?: string \| null/);
  assert.match(store, /restoreStoredMembership/);
  assert.match(store, /UPDATE members SET token_hash = \?/);
  assert.match(rooms, /authenticateRequestUser/);
  assert.match(rooms, /currentUser\?\.nickname \|\| creatorName/);
  assert.match(members, /export async function GET/);
  assert.match(members, /currentUser\?\.nickname \|\| name/);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --experimental-strip-types --test tests/wechat-membership.test.mjs`  
Expected: FAIL because user linkage does not exist.

- [ ] **Step 3: Add optional user linkage to storage**

Add `userId: string | null` to `StoredMember` and `MemberRow`. Update member selects and inserts. `createStoredRoom` and `joinStoredRoom` accept `userId?: string | null`. Before joining, if the same non-null userId already belongs to the room, rotate its member token and return the existing member instead of consuming a second seat.

`restoreStoredMembership` must:

1. Select member id by `room_code + user_id`.
2. Generate a new random member token.
3. Store only its hash.
4. Return `{ memberId, memberToken }`.

- [ ] **Step 4: Make rooms and members routes dual-mode**

- With valid Bearer auth, use the stored user nickname and user id; ignore a client nickname.
- Without Bearer auth, retain the current H5 validation and `creatorName`/`name` behavior.
- If an Authorization header exists but is invalid, return `401`; do not silently downgrade to anonymous.
- Add `GET /api/members?roomCode=ABC123` for a logged-in miniapp user to restore membership.
- Keep all existing memberToken checks for room mutations.

- [ ] **Step 5: Run focused and full server tests**

Run: `node --experimental-strip-types --test tests/wechat-membership.test.mjs tests/rendered-html.test.mjs tests/room-readiness.test.mjs`  
Expected: all tests PASS.

Run: `npm test`  
Expected: existing 112 tests plus new tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/room-store.ts app/api/rooms/route.ts app/api/members/route.ts tests/wechat-membership.test.mjs
git commit -m "feat: link WeChat users to room members"
```

---

### Task 4: Taro 小程序工程、主题与可重复构建

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `miniapp/package.json`
- Create: `miniapp/project.config.json`
- Create: `miniapp/config/index.ts`
- Create: `miniapp/config/dev.ts`
- Create: `miniapp/config/prod.ts`
- Create: `miniapp/src/app.ts`
- Create: `miniapp/src/app.config.ts`
- Create: `miniapp/src/app.scss`
- Create: `miniapp/src/pages/home/index.tsx`
- Create: `miniapp/src/pages/home/index.config.ts`
- Create: `miniapp/src/pages/home/index.scss`
- Create: `tests/miniapp-foundation.test.mjs`

**Interfaces:**
- Produces: `npm run miniapp:build`.
- Produces: compiled output at `miniapp/dist` for WeChat developer tools.

- [ ] **Step 1: Write failing project-contract test**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("miniapp is a native Taro workspace with the correct AppID", async () => {
  const [rootPackage, miniPackage, project, appConfig] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../miniapp/package.json", import.meta.url), "utf8"),
    readFile(new URL("../miniapp/project.config.json", import.meta.url), "utf8"),
    readFile(new URL("../miniapp/src/app.config.ts", import.meta.url), "utf8"),
  ]);
  assert.match(rootPackage, /miniapp:build/);
  assert.match(miniPackage, /"@tarojs\/taro": "4\.2\.1"/);
  assert.equal(JSON.parse(project).appid, "wx7162630074a237b6");
  assert.match(appConfig, /pages\/home\/index/);
  assert.doesNotMatch(appConfig, /web-view/);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --experimental-strip-types --test tests/miniapp-foundation.test.mjs`  
Expected: FAIL because `miniapp` does not exist.

- [ ] **Step 3: Add npm workspace and pinned dependencies**

Root package:

```json
{
  "workspaces": ["miniapp"],
  "scripts": {
    "miniapp:dev": "npm --workspace miniapp run dev:weapp",
    "miniapp:build": "npm --workspace miniapp run build:weapp"
  }
}
```

Miniapp package uses exactly Taro `4.2.1`, React `18.3.1`, React DOM `18.3.1`, TypeScript `5.9.3`, Sass, and the webpack5 runner. Configure `sourceRoot: "src"`, `outputRoot: "dist"`, and CSS modules off.

- [ ] **Step 4: Add project and app configuration**

`project.config.json` must set `miniprogramRoot: "dist/"`, `appid: "wx7162630074a237b6"`, ES6/TypeScript compilation on, and URL validation enabled by default. `app.config.ts` registers all eight pages in the order home, create, room, availability, constraints, swipe, discovery, result.

- [ ] **Step 5: Add global theme and a compiling home shell**

Define CSS variables for `--ink`, `--purple`, `--blue`, `--orange`, `--green`, `--surface`, safe-area padding and 16px minimum body text. The initial home page renders the logo, title, two disabled visual choice cards and a loading label; functionality arrives in later tasks.

- [ ] **Step 6: Install, test and build**

Run: `npm install`  
Expected: lockfile updates without dependency resolution errors.

Run: `node --experimental-strip-types --test tests/miniapp-foundation.test.mjs`  
Expected: PASS.

Run: `npm run miniapp:build`  
Expected: Taro produces `miniapp/dist/app.json` and `miniapp/dist/pages/home/index.js`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json miniapp tests/miniapp-foundation.test.mjs
git commit -m "feat: scaffold Taro WeChat miniapp"
```

---

### Task 5: 小程序请求层、静默登录与本地身份恢复

**Files:**
- Create: `miniapp/src/types/api.ts`
- Create: `miniapp/src/domain/session.ts`
- Create: `miniapp/src/services/request.ts`
- Create: `miniapp/src/services/auth.ts`
- Create: `miniapp/src/store/session.ts`
- Create: `miniapp/src/components/AppState/index.tsx`
- Create: `miniapp/src/components/AppState/index.scss`
- Modify: `miniapp/src/app.ts`
- Create: `tests/miniapp-session.test.mjs`

**Interfaces:**
- Produces: `apiRequest<T>(path, options)` with bearer injection and 12-second timeout.
- Produces: `loginWithWechat()` → `Promise<Session>`.
- Produces: `loadSession`, `saveSession`, `clearSession`, `loadMembership`, `saveMembership`.
- Produces: `resolveLaunchRoom(query)` → normalized six-character room code or `null`.

- [ ] **Step 1: Write failing pure session tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { membershipStorageKey, normalizeRoomCode, resolveLaunchRoom } from "../miniapp/src/domain/session.ts";

test("launch room accepts only a six-character room code", () => {
  assert.equal(resolveLaunchRoom({ room: " ab12cd " }), "AB12CD");
  assert.equal(resolveLaunchRoom({ room: "bad" }), null);
});

test("membership storage is isolated by room", () => {
  assert.equal(membershipStorageKey("AB12CD"), "couju:membership:AB12CD");
  assert.equal(normalizeRoomCode("a-b"), "AB");
});
```

- [ ] **Step 2: Verify failure**

Run: `node --experimental-strip-types --test tests/miniapp-session.test.mjs`  
Expected: FAIL because the domain file is missing.

- [ ] **Step 3: Define DTOs and pure session helpers**

Mirror only fields used by the miniapp: `Session`, `Membership`, `RoomSummary`, `ParticipantRoom`, `Candidate`, `Choice`, `RejectionReason`, `RoundInsight`, `ResolvedSchedule`. Do not import server-only modules into the miniapp bundle.

- [ ] **Step 4: Add request and storage adapters**

`apiRequest` reads `TARO_APP_API_BASE`, adds `Authorization: Bearer` when a session exists, rejects non-2xx responses as `ApiError(status, message)`, and uses `Taro.request` timeout `12000`. A 401 clears only the session; a member 403 clears only that room membership. Miniapp state names the secret `memberToken`, but the adapter serializes it under the existing API field `token` so H5 and server DTOs do not need a breaking rename.

- [ ] **Step 5: Bootstrap silent login**

On app launch:

1. Call `Taro.login()`.
2. POST `{ code }` to `/api/auth/wechat`.
3. Save the returned session.
4. Render page content.
5. On failure, show `AppState` with “微信登录失败” and a retry button; never create a client-generated user id.

- [ ] **Step 6: Test and build**

Run: `node --experimental-strip-types --test tests/miniapp-session.test.mjs`  
Expected: PASS.

Run: `npm run miniapp:build`  
Expected: PASS with no missing Taro imports.

- [ ] **Step 7: Commit**

```bash
git add miniapp/src tests/miniapp-session.test.mjs
git commit -m "feat: add miniapp authentication shell"
```

---

### Task 6: 首页、创建房间与加入房间

**Files:**
- Create: `miniapp/src/domain/create-room.ts`
- Create: `miniapp/src/services/rooms.ts`
- Create: `miniapp/src/services/location.ts`
- Create: `miniapp/src/components/BrandHeader/index.tsx`
- Create: `miniapp/src/components/PrimaryButton/index.tsx`
- Modify: `miniapp/src/pages/home/index.tsx`
- Modify: `miniapp/src/pages/home/index.scss`
- Create: `miniapp/src/pages/create/index.tsx`
- Create: `miniapp/src/pages/create/index.config.ts`
- Create: `miniapp/src/pages/create/index.scss`
- Create: `tests/miniapp-create-room.test.mjs`

**Interfaces:**
- Produces: `validateCreateDraft(draft)` → `{ ok: true } | { ok: false; message: string }`.
- Produces: `createRoom(draft, user)` and `joinRoom(roomCode, origin, originLocation)`.
- Consumes: existing candidates API before rooms POST, matching current H5 behavior.

- [ ] **Step 1: Write failing form-domain tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { initialCreateDraft, validateCreateDraft } from "../miniapp/src/domain/create-room.ts";

test("room kind comes from the home choice and is not asked twice", () => {
  const dining = initialCreateDraft("dining");
  assert.equal(dining.kind, "dining");
  assert.equal("nickname" in dining, false);
});

test("creation requires origin, dates, periods, duration and people", () => {
  const result = validateCreateDraft({ ...initialCreateDraft("activity"), city: "上海" });
  assert.deepEqual(result, { ok: false, message: "请填写出发地" });
});
```

- [ ] **Step 2: Verify failure**

Run: `node --experimental-strip-types --test tests/miniapp-create-room.test.mjs`  
Expected: FAIL because the domain file is missing.

- [ ] **Step 3: Build the home page**

Render the Couju logo, “不知道干啥？别再纠结了”, the orange “一起吃饭” card, purple “出去玩” card, and a compact “加入好友的局” room-code input. If launch query contains a valid room code, prefill it and open the join panel. Do not repeat the room type on the create page.

- [ ] **Step 4: Build the create form**

Fields: city, origin, location button, date range, multi-select morning/afternoon/evening, duration 2h/3h/4h/4h+/uncertain, inspiration/idea mode, conditional tendencies, people 2–6. Nickname is shown read-only in a small profile row with an optional “使用微信昵称” input, not a required form field.

Submit flow:

1. Validate draft.
2. Resolve or geocode origin.
3. Fetch exactly 12 unique candidates.
4. POST room using Bearer auth; omit `creatorName` for miniapp.
5. Save returned membership and navigate to room.

- [ ] **Step 5: Add join flow and consent-based location**

Join asks only for room code and origin. Location is requested only after tapping “定位”; denial or timeout leaves manual input enabled. POST members with Bearer auth and no client nickname.

- [ ] **Step 6: Test and build**

Run: `node --experimental-strip-types --test tests/miniapp-create-room.test.mjs tests/miniapp-session.test.mjs`  
Expected: PASS.

Run: `npm run miniapp:build`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add miniapp/src tests/miniapp-create-room.test.mjs
git commit -m "feat: add miniapp create and join flow"
```

---

### Task 7: 房间大厅、空闲时间与个人边界

**Files:**
- Create: `miniapp/src/domain/room-stage.ts`
- Create: `miniapp/src/services/members.ts`
- Create: `miniapp/src/pages/room/index.tsx`
- Create: `miniapp/src/pages/room/index.config.ts`
- Create: `miniapp/src/pages/room/index.scss`
- Create: `miniapp/src/pages/availability/index.tsx`
- Create: `miniapp/src/pages/availability/index.config.ts`
- Create: `miniapp/src/pages/availability/index.scss`
- Create: `miniapp/src/pages/constraints/index.tsx`
- Create: `miniapp/src/pages/constraints/index.config.ts`
- Create: `miniapp/src/pages/constraints/index.scss`
- Create: `tests/miniapp-room-stage.test.mjs`

**Interfaces:**
- Produces: `nextRequiredPage(room, memberId)` → one of room/availability/constraints/swipe/result.
- Consumes: existing `/api/availability`, members constraints action, participant room DTO.

- [ ] **Step 1: Write failing stage tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { nextRequiredPage } from "../miniapp/src/domain/room-stage.ts";

test("shared cards stay locked until every target member is ready", () => {
  const room = {
    config: { people: 2 },
    members: [
      { id: "a", availability: [{ date: "2026-09-01", start: "18:00", end: "21:00" }], constraintsReady: true },
    ],
  };
  assert.equal(nextRequiredPage(room, "a"), "room");
});

test("member completes time before constraints", () => {
  const room = { config: { people: 1 }, members: [{ id: "a", availability: null, constraintsReady: false }] };
  assert.equal(nextRequiredPage(room, "a"), "availability");
});
```

- [ ] **Step 2: Verify failure**

Run: `node --experimental-strip-types --test tests/miniapp-room-stage.test.mjs`  
Expected: FAIL because room stage logic is missing.

- [ ] **Step 3: Build room polling and progress UI**

Poll participant room every four seconds while visible; stop polling on hide/unload. Show member counts, each member’s completion state, room code, share button and exactly one next action. Restore membership through `GET /api/members?roomCode=` when login exists but local member data is absent.

- [ ] **Step 4: Build range-based availability**

For each date, render start and end selectors plus “添加另一段时间”. Validate start < end, intervals inside the room date range, no overlap, and submit the exact existing interval DTO. Do not reintroduce 30-minute grid cards.

- [ ] **Step 5: Build constraints**

Render budget, commute 30/60/90/unlimited and scene preference. Submitting constraints calls the existing intersection-building action. A 409 candidate shortage displays the server message and a route back to edit commute; it must not look like indefinite calculation.

- [ ] **Step 6: Test and build**

Run: `node --experimental-strip-types --test tests/miniapp-room-stage.test.mjs`  
Expected: PASS.

Run: `npm run miniapp:build`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add miniapp/src tests/miniapp-room-stage.test.mjs
git commit -m "feat: add miniapp room setup flow"
```

---

### Task 8: 12 张共享卡反馈

**Files:**
- Create: `miniapp/src/domain/swipe.ts`
- Create: `miniapp/src/services/rounds.ts`
- Create: `miniapp/src/components/CandidateCard/index.tsx`
- Create: `miniapp/src/components/CandidateCard/index.scss`
- Create: `miniapp/src/components/RejectionSheet/index.tsx`
- Create: `miniapp/src/components/RejectionSheet/index.scss`
- Create: `miniapp/src/pages/swipe/index.tsx`
- Create: `miniapp/src/pages/swipe/index.config.ts`
- Create: `miniapp/src/pages/swipe/index.scss`
- Create: `tests/miniapp-swipe.test.mjs`

**Interfaces:**
- Produces: `recordChoice(state, candidateId, choice, reason?)`.
- Produces: `canSubmitSharedRound(candidateIds, choices)`.
- Consumes: existing members PATCH submission contract.

- [ ] **Step 1: Write failing swipe-state tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { canSubmitSharedRound, recordChoice } from "../miniapp/src/domain/swipe.ts";

test("all twelve current candidates must be rated", () => {
  const ids = Array.from({ length: 12 }, (_, index) => `c${index}`);
  const choices = Object.fromEntries(ids.slice(0, 11).map((id) => [id, "neutral"]));
  assert.equal(canSubmitSharedRound(ids, choices), false);
  choices.c11 = "like";
  assert.equal(canSubmitSharedRound(ids, choices), true);
});

test("changing rejection clears its old reason", () => {
  const rejected = recordChoice({ choices: {}, reasons: {} }, "c1", "reject", "排队");
  const liked = recordChoice(rejected, "c1", "like");
  assert.equal(liked.reasons.c1, undefined);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --experimental-strip-types --test tests/miniapp-swipe.test.mjs`  
Expected: FAIL because swipe domain is missing.

- [ ] **Step 3: Build candidate card and controls**

Candidate card displays image, name, type, district, known per-person price and estimated commute. Provide large “不喜欢 / 一般 / 喜欢” buttons and optional horizontal swipe gestures; buttons remain available for accessibility. Progress is `current / 12`.

- [ ] **Step 4: Build compact rejection sheet**

Use a bottom half-screen sheet. Dining reasons exclude price and include queue, taste/category, environment and distance; activity reasons include intensity, interest/category, environment and distance. Reason is optional. Closing the sheet retains the reject choice.

- [ ] **Step 5: Submit exactly once**

After card 12, POST all 12 choices with expectedRound, stored constraints, rejection reasons and no AI extraction detour. Disable while submitting. On 409 reload the current round; on other failure preserve selections and offer retry.

- [ ] **Step 6: Test and build**

Run: `node --experimental-strip-types --test tests/miniapp-swipe.test.mjs tests/member-submission.test.mjs tests/rejection-feedback.test.mjs`  
Expected: PASS.

Run: `npm run miniapp:build`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add miniapp/src tests/miniapp-swipe.test.mjs
git commit -m "feat: add miniapp shared card feedback"
```

---

### Task 9: 私人发现、AI 学习摘要、冲突诊断与最终结果

**Files:**
- Create: `miniapp/src/domain/result-action.ts`
- Create: `miniapp/src/pages/discovery/index.tsx`
- Create: `miniapp/src/pages/discovery/index.config.ts`
- Create: `miniapp/src/pages/discovery/index.scss`
- Create: `miniapp/src/pages/result/index.tsx`
- Create: `miniapp/src/pages/result/index.config.ts`
- Create: `miniapp/src/pages/result/index.scss`
- Modify: `miniapp/src/pages/room/index.tsx`
- Create: `tests/miniapp-result.test.mjs`

**Interfaces:**
- Produces: `resultAction(room, memberId)` → result/wait/private-discovery/advance/edit-commute.
- Consumes: candidates private mode, rounds nomination/advance, insights and explain APIs.

- [ ] **Step 1: Write failing result-action tests**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { resultAction } from "../miniapp/src/domain/result-action.ts";

test("all-rejected member receives private discovery before round two", () => {
  const room = { currentRound: 1, hasResult: false, canPrivateDiscover: ["a"], canAdvance: false };
  assert.equal(resultAction(room, "a"), "private-discovery");
});

test("only creator sees advance when every recovery action is complete", () => {
  const room = { currentRound: 1, hasResult: false, canPrivateDiscover: [], canAdvance: true, creatorId: "a" };
  assert.equal(resultAction(room, "a"), "advance");
  assert.equal(resultAction(room, "b"), "wait");
});
```

- [ ] **Step 2: Verify failure**

Run: `node --experimental-strip-types --test tests/miniapp-result.test.mjs`  
Expected: FAIL because result action logic is missing.

- [ ] **Step 3: Build three-card private discovery**

Fetch private candidates only when the service gate permits it. Render exactly three cards as a single-select nomination; tapping the selected card again clears it. “跳过” submits null nomination. Private cards remain invisible to other members until nominated.

- [ ] **Step 4: Build result and no-result states**

- Result: show one final recommendation, schedule, known price, member scores and concise explanation.
- No shared result: show “AI 学到了什么” only after a completed round, then the deterministic conflict diagnosis.
- Commute negotiation: show the smallest relaxation proposed by the service and require that member to confirm it.
- Waiting: name the pending action without exposing another member’s private choices.
- Creator advance: visible only after service gate allows it; disable during request and reload on success.

- [ ] **Step 5: Add native room sharing**

Room and result pages implement `useShareAppMessage` with path `pages/home/index?room=${roomCode}` and type-specific title. Assert no token-like query keys appear.

- [ ] **Step 6: Test and build**

Run: `node --experimental-strip-types --test tests/miniapp-result.test.mjs tests/private-discovery-flow.test.mjs tests/round-insight.test.mjs tests/rounds-api.test.mjs`  
Expected: PASS.

Run: `npm run miniapp:build`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add miniapp/src tests/miniapp-result.test.mjs
git commit -m "feat: complete miniapp multi-round decision flow"
```

---

### Task 10: 微信昵称入口、手机视觉验收与文档

**Files:**
- Create: `miniapp/src/components/ProfileNickname/index.tsx`
- Create: `miniapp/src/components/ProfileNickname/index.scss`
- Modify: `miniapp/src/pages/home/index.tsx`
- Modify: `miniapp/src/pages/room/index.tsx`
- Modify: `miniapp/src/app.scss`
- Modify: `README.md`
- Create: `tests/miniapp-release-contract.test.mjs`

**Interfaces:**
- Consumes: profile PATCH from Task 2.
- Produces: user-triggered nickname selection with automatic-name fallback.

- [ ] **Step 1: Write failing release-contract test**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("miniapp release contract keeps secrets out and documents real setup", async () => {
  const [project, profile, readme, envExample] = await Promise.all([
    readFile(new URL("../miniapp/project.config.json", import.meta.url), "utf8"),
    readFile(new URL("../miniapp/src/components/ProfileNickname/index.tsx", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);
  assert.equal(JSON.parse(project).appid, "wx7162630074a237b6");
  assert.match(profile, /type=["']nickname["']/);
  assert.match(readme, /微信开发者工具/);
  assert.match(readme, /miniapp\/dist/);
  assert.doesNotMatch(project + profile + readme, /WECHAT_APP_SECRET\s*[:=]\s*[^\s"']+/);
  assert.match(envExample, /WECHAT_TOKEN_SECRET=/);
});
```

- [ ] **Step 2: Verify failure**

Run: `node --experimental-strip-types --test tests/miniapp-release-contract.test.mjs`  
Expected: FAIL because the nickname component or built output is absent.

- [ ] **Step 3: Add optional nickname component**

Render the current nickname and an `Input type="nickname"`. Updating requires explicit confirm, calls profile PATCH, updates local session and leaves the old automatic nickname untouched on cancel or failure. Do not request an avatar.

- [ ] **Step 4: Complete mobile visual QA in source**

Apply single-column layouts at 320–430 CSS px, minimum 44px tap targets, `padding-bottom: calc(24px + env(safe-area-inset-bottom))`, no fixed pixel page widths, text wrapping for long POI names, and sticky actions above the safe area. Use separate loading, empty, no-intersection, location-failure and service-failure states.

- [ ] **Step 5: Update README with only executable instructions**

Document:

1. `npm install`
2. `npm run miniapp:build`
3. Import repository `miniapp` directory in 微信开发者工具.
4. AppID is already set.
5. Development can disable request-domain validation.
6. Server must configure `WECHAT_APP_ID`, `WECHAT_APP_SECRET`, and `WECHAT_TOKEN_SECRET`.
7. Formal release and review are not yet claimed.

- [ ] **Step 6: Run complete verification**

Run: `npm run miniapp:build`  
Expected: PASS and `miniapp/dist/app.json` exists.

Run: `node --experimental-strip-types --test tests/miniapp-release-contract.test.mjs`  
Expected: PASS.

Run: `npm test`  
Expected: all existing and new tests PASS.

Run: `git diff --check`  
Expected: no output.

- [ ] **Step 7: Manual developer-tools acceptance**

Import `miniapp` in 微信开发者工具 and verify with two independent storage profiles or two configured tester accounts:

1. Both silently log in with automatic names.
2. User A creates an eating room and shares its room code.
3. User B enters through the shared room query and joins without typing a name.
4. Both submit availability and constraints.
5. Both rate 12 shared cards.
6. A no-result run opens three private cards per eligible member and permits nominate or skip.
7. Creator advances to round two.
8. A successful run shows one final result.
9. Location denial still permits manual origin input.
10. Relaunch restores the same user and room membership.

- [ ] **Step 8: Commit**

```bash
git add miniapp/src README.md tests/miniapp-release-contract.test.mjs
git commit -m "docs: finish miniapp developer preview"
```

---

## Final Branch Verification

- [ ] Run `git status --short`; expected output is empty.
- [ ] Run `git log --oneline main..feat/wechat-mini-program`; expected output contains the design commits and Tasks 1–10 commits.
- [ ] Run `npm test`; expected all tests PASS.
- [ ] Run `npm run miniapp:build`; expected PASS.
- [ ] Confirm `git diff main...HEAD -- . ':!miniapp/dist'` contains no secret values.
- [ ] Use `superpowers:requesting-code-review` before merging or publishing the branch.
