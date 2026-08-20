import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
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
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>凑局 Couju — Group Decision OS<\/title>/i);
  assert.match(html, /把群聊里的/);
  assert.match(html, /体验完整决策/);
  assert.match(html, /私密偏好 · 公平共识/);
  assert.match(html, /不是多数票，是公平共识/);
  assert.match(html, /activity-kart\.jpg/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
});
test("keeps the interactive decision flow and scene data in the product source", async () => {
  const [page, css, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(packageJson, /"name": "couju-group-decision-os"/);
  assert.match(page, /type DecisionKind = "activity" \| "dining"/);
  assert.match(page, /type="date"/);
  assert.match(page, /type="time"/);
  assert.match(page, /\[2,3,4,5,6\]/);
  assert.match(page, /const activityCards: Candidate\[\]/);
  assert.match(page, /const diningCards: Candidate\[\]/);
  assert.match(page, /setVetoed\(true\)/);
  assert.match(page, /text\/calendar/);
  assert.match(css, /\.form-control/);
  assert.match(css, /\.photo-winner/);

  await access(new URL("../public/candidates/activity-kart.jpg", import.meta.url));
  await access(new URL("../public/candidates/food-yunnan.jpg", import.meta.url));
  await access(new URL("../docs/AI_WORKFLOW.md", import.meta.url));
});
