import assert from "node:assert/strict";
import test from "node:test";
import { LoopbackMetaMaskConsent } from "../../src/metamask-smart-account-consent.js";
import type { Address } from "../../src/model.js";

const SESSION = "0x2222222222222222222222222222222222222222" as Address;
const REQUEST = {
  sessionAddress: SESSION,
  capAtomic: "2000000",
  startsAtUnix: 1_788_393_600,
  expiresAtUnix: 1_788_397_200,
};

test("loopback consent keeps its capability in the fragment and serves an exact no-store origin", async () => {
  const expected = { bridge: "accepted" };
  let fragmentToken = "";
  const consent = new LoopbackMetaMaskConsent(async (openedUrl) => {
    const opened = new URL(openedUrl);
    assert.equal(opened.hostname, "127.0.0.1");
    assert.match(opened.port, /^[1-9][0-9]*$/u);
    assert.equal(opened.pathname, "/");
    assert.equal(opened.search, "");
    fragmentToken = opened.hash.slice(1);
    assert.match(fragmentToken, /^[a-f0-9]{64}$/u);

    const page = await fetch(`${opened.origin}/`);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("cache-control"), "no-store");
    assert.equal(page.headers.get("referrer-policy"), "no-referrer");
    assert.equal(page.headers.get("x-content-type-options"), "nosniff");
    assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'none'/u);
    const html = await page.text();
    assert.equal(html.includes(fragmentToken), false);

    const scriptResponse = await fetch(`${opened.origin}/app.js`);
    assert.equal(scriptResponse.status, 200);
    const script = await scriptResponse.text();
    assert.equal(script.includes(fragmentToken), false);
    assert.match(script, /wallet_requestExecutionPermissions/u);
    assert.match(script, /wallet_getGrantedExecutionPermissions/u);
    assert.match(script, /eip6963:requestProvider/u);
    assert.match(script, /info\.rdns === "io\.metamask"/u);
    assert.match(script, /provider\.isRabby !== true/u);
    assert.match(script, /allowance\.ruleTypes\.includes\("expiry"\)/u);
    assert.match(script, /"capAtomic":"2000000"/u);
    assert.match(script, /history\.replaceState\(null, "", "\/"\)/u);

    const callback = await fetch(`${opened.origin}/callback`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: opened.origin },
      body: JSON.stringify({ token: fragmentToken, outcome: { ok: true, value: expected } }),
    });
    assert.equal(callback.status, 204);
  }, 1_000);
  assert.deepEqual(await consent.request(REQUEST), expected);
});

test("loopback consent fails closed on a wrong origin or token and never accepts a follow-up", async () => {
  let secondAttemptAccepted = false;
  const consent = new LoopbackMetaMaskConsent(async (openedUrl) => {
    const opened = new URL(openedUrl);
    const rejected = await fetch(`${opened.origin}/callback`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://127.0.0.1:1" },
      body: JSON.stringify({ token: opened.hash.slice(1), outcome: { ok: true, value: {} } }),
    });
    assert.equal(rejected.status, 400);
    try {
      const second = await fetch(`${opened.origin}/callback`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: opened.origin },
        body: JSON.stringify({ token: opened.hash.slice(1), outcome: { ok: true, value: {} } }),
      });
      secondAttemptAccepted = second.status === 204;
    } catch {
      secondAttemptAccepted = false;
    }
  }, 1_000);
  await assert.rejects(consent.request(REQUEST), (error: any) => error.code === "APN_PROVIDER_PROTOCOL");
  assert.equal(secondAttemptAccepted, false);
});

test("loopback consent deadline also bounds a browser opener that never resolves", async () => {
  const consent = new LoopbackMetaMaskConsent(async () => await new Promise<void>(() => undefined), 10);
  const started = Date.now();
  await assert.rejects(consent.request(REQUEST), (error: any) =>
    error.code === "APN_PROVIDER_UNAVAILABLE" && error.details?.retryable === true
  );
  assert.ok(Date.now() - started < 1_000);
});

test("loopback consent maps browser launch failure without leaking its cause", async () => {
  const consent = new LoopbackMetaMaskConsent(async () => { throw new Error("PROTECTED_CANARY"); }, 1_000);
  await assert.rejects(consent.request(REQUEST), (error: any) =>
    error.code === "APN_PROVIDER_UNAVAILABLE" && !String(error.message).includes("PROTECTED_CANARY")
  );
});

test("loopback consent rejects unknown routes, non-exact callback shapes and oversized bodies", async () => {
  const cases = [
    async (opened: URL) => await fetch(`${opened.origin}/unknown`),
    async (opened: URL) => await fetch(`${opened.origin}/callback`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: opened.origin },
      body: JSON.stringify({ token: opened.hash.slice(1), outcome: { ok: true, value: {}, extra: true } }),
    }),
    async (opened: URL) => await fetch(`${opened.origin}/callback`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: opened.origin },
      body: "x".repeat(256 * 1024 + 1),
    }),
  ];
  for (const invoke of cases) {
    const consent = new LoopbackMetaMaskConsent(async (openedUrl) => {
      const response = await invoke(new URL(openedUrl));
      assert.equal(response.status, 400);
      assert.equal(response.headers.get("location"), null);
    }, 1_000);
    await assert.rejects(consent.request(REQUEST), (error: any) => error.code === "APN_PROVIDER_PROTOCOL");
  }
});
