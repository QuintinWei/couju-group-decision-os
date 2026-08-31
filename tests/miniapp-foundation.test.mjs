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
