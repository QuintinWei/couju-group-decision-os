import assert from "node:assert/strict";
import test from "node:test";

test("device location retries once after a timeout and then returns the position", async () => {
  const { requestBrowserPosition } = await import("../lib/browser-location.ts");
  let attempts = 0;
  const position = await requestBrowserPosition((success, failure) => {
    attempts += 1;
    if (attempts === 1) failure({ code: 3, message: "timeout" });
    else success({ coords: { latitude: 31.2304, longitude: 121.4737 } });
  });

  assert.equal(attempts, 2);
  assert.equal(position.coords.latitude, 31.2304);
});

test("device location does not retry when permission is denied", async () => {
  const { requestBrowserPosition } = await import("../lib/browser-location.ts");
  let attempts = 0;
  await assert.rejects(
    requestBrowserPosition((_success, failure) => {
      attempts += 1;
      failure({ code: 1, message: "denied" });
    }),
    (error) => error.code === 1,
  );
  assert.equal(attempts, 1);
});
