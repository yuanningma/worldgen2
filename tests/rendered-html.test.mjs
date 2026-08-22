import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://atlas-forge.test/", {
      headers: {
        accept: "text/html",
        "x-forwarded-host": "atlas-forge.test",
        "x-forwarded-proto": "https",
      },
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Atlas Forge studio shell and social metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Atlas Forge — Procedural Fantasy Worlds<\/title>/i);
  assert.match(html, /ATLAS FORGE/);
  assert.match(html, /Shape a world\./);
  assert.match(html, /GENESIS ENGINE/);
  assert.match(html, /GLOBE/);
  assert.match(html, /ATLAS/);
  assert.match(html, /https:\/\/atlas-forge\.test\/og\.png/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|react-loading-skeleton/i);
});
