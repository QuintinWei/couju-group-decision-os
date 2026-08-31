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

test("miniapp shell preserves 16px minimum logical text after px transformation", async () => {
  const [appScss, homeScss] = await Promise.all([
    readFile(new URL("../miniapp/src/app.scss", import.meta.url), "utf8"),
    readFile(new URL("../miniapp/src/pages/home/index.scss", import.meta.url), "utf8"),
  ]);
  const fontSizes = [...`${appScss}\n${homeScss}`.matchAll(/font-size:\s*(\d+)px/g)]
    .map((match) => Number(match[1]));

  assert.ok(fontSizes.length > 0);
  assert.ok(fontSizes.every((size) => size >= 32));
});

test("miniapp generated files and types stay isolated from root tooling", async () => {
  const [eslintConfig, rootTsconfig, miniappTsconfig] = await Promise.all([
    readFile(new URL("../eslint.config.mjs", import.meta.url), "utf8"),
    readFile(new URL("../tsconfig.json", import.meta.url), "utf8"),
    readFile(new URL("../miniapp/tsconfig.json", import.meta.url), "utf8"),
  ]);
  const parsedRootTsconfig = JSON.parse(rootTsconfig);
  const parsedMiniappTsconfig = JSON.parse(miniappTsconfig);

  assert.match(eslintConfig, /miniapp\/dist\/\*\*/);
  assert.ok(parsedRootTsconfig.exclude.includes("miniapp"));
  assert.ok(parsedMiniappTsconfig.include.includes("src/**/*.tsx"));
});
