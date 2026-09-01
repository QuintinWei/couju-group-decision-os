# Task 6 recovery report — 首页、创建房间与加入房间

## Delivered

- Recovered the unfinished create-room domain, room service, and focused behavioral tests.
- Added the Couju home with the orange dining card, purple activity card, compact room-code join panel, and share-query room-code prefill.
- Added the create form with city, manual/consent-based location, date range, multi-select time periods, all duration choices, conditional idea tendencies, and a 2–6 person selector. The selected room kind is carried from home and is not asked again.
- Added room creation and joining adapters. Creation resolves origin, fetches exactly 12 unique candidates before the Bearer-authenticated room POST, omits `creatorName`, persists membership, and navigates onward. Joining submits only room code, origin, and optional coordinates.
- Added location timeout/permission handling that preserves manual origin entry.
- Added reusable brand header and primary button components.

## Verification

- `node --experimental-strip-types --test tests/miniapp-create-room.test.mjs tests/miniapp-session.test.mjs` — 9 passing.
- `npm --workspace miniapp run typecheck` — passing.
- `npm run miniapp:build` — passing.
- `npm test` — 142 passing.

## Notes

- Node emits existing module-type performance warnings while directly loading nested miniapp TypeScript test modules. They do not affect the TypeScript check, Taro build, or test results.
- The optional nickname input is displayed without becoming a creation field; its profile-update behavior is intentionally owned by Task 10.

## Review follow-up

- Declared `requiredPrivateInfos: ["getLocation"]` and a `permission.scope.userLocation.desc` in the app configuration. The generated `miniapp/dist/app.json` was inspected after a fresh build and contains both fields.
- Added a contract test for the location privacy declaration and a page-source contract for shared room-code prefill and create-kind navigation.
- Calendar validation now rejects normalized invalid dates and blocks ranges longer than the server's inclusive 14-day limit before any origin resolution or candidate request.
- Tendency selection is capped at six in the create UI with an explicit message; service code no longer silently truncates selections. The room POST test asserts selected periods and duration are preserved.

Follow-up verification: focused miniapp tests (16 passing), typecheck, miniapp build, generated `app.json` location declaration check, and full `npm test` (146 passing).
