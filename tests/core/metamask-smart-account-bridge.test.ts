import assert from "node:assert/strict";
import test from "node:test";
import { allocateConsentPort, LoopbackMetaMaskConsent } from "../../src/metamask-smart-account-consent.js";
import { REQUEST, runServedBrowser, waitFor, type BrowserProvider } from "./smart-account-browser-harness.js";

test("loopback consent keeps its capability in the fragment and serves an exact no-store origin", async () => {
  const expected = { bridge: "accepted" };
  let fragmentToken = "";
  let servedHtml = "";
  let servedScript = "";
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
    servedHtml = await page.text();
    assert.equal(servedHtml.includes(fragmentToken), false);

    const scriptResponse = await fetch(`${opened.origin}/app.js`);
    assert.equal(scriptResponse.status, 200);
    servedScript = await scriptResponse.text();
    assert.equal(servedScript.includes(fragmentToken), false);
    assert.match(servedScript, /wallet_requestExecutionPermissions/u);
    assert.match(servedScript, /wallet_getGrantedExecutionPermissions/u);
    assert.match(servedScript, /eip6963:requestProvider/u);
    assert.match(servedScript, /allowance\.ruleTypes\.includes\("expiry"\)/u);
    assert.match(servedScript, /"capAtomic":"2000000"/u);
    assert.match(servedScript, /history\.replaceState\(null, "", "\/"\)/u);

    const callback = await fetch(`${opened.origin}/callback`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: opened.origin },
      body: JSON.stringify({ token: fragmentToken, outcome: { ok: true, value: expected } }),
    });
    assert.equal(callback.status, 204);
  }, 1_000);
  assert.deepEqual(await consent.request({ ...REQUEST, port: await allocateConsentPort() }), expected);
  assert.match(servedHtml, /id="providers"/u);
  assert.match(servedHtml, /unverified/iu);
  assert.doesNotMatch(servedScript, /info\.rdns === "io\.metamask"/u);
  assert.doesNotMatch(servedScript, /provider\.isRabby !== true/u);
  assert.doesNotMatch(servedScript, /innerHTML/u);
  assert.match(servedScript, /textContent/u);
});

test("served browser requires an explicit click for one forged EIP-6963 identity", async () => {
  const calls: unknown[] = [];
  const provider: BrowserProvider = {
    isMetaMask: true,
    request: async (request) => {
      calls.push(request);
      throw Object.assign(new Error("fixture stop"), { code: 4001 });
    },
  };
  const forged = {
    provider,
    info: { name: "Forged MetaMask", rdns: "io.metamask", uuid: "forged-uuid" },
  };
  const browser = await runServedBrowser({ announcements: [forged, forged] });
  await waitFor(() => browser.document.buttons().length > 0 || calls.length > 0 || browser.posts.length > 0, "provider choice");
  assert.equal(calls.length, 0, "provider must receive no request before an explicit click");
  assert.equal(browser.document.buttons().length, 1, "the same provider object is deduplicated");
  const [button] = browser.document.buttons();
  assert.match(button?.textContent ?? "", /Source: EIP-6963 announcement/u);
  assert.match(button?.textContent ?? "", /Forged MetaMask/u);
  assert.match(button?.textContent ?? "", /io\.metamask/u);
  assert.match(button?.textContent ?? "", /forged-uuid/u);
  assert.match(button?.textContent ?? "", /unverified/iu);
  button?.click();
  await waitFor(() => browser.posts.length > 0, "selected provider result");
  assert.equal(browser.document.buttons().every((choice) => choice.disabled), true);
  button?.click();
  await Promise.resolve();
  assert.equal(calls.length, 1);
});

test("served browser keeps forged duplicate identities separate and invokes only the clicked provider", async () => {
  const firstCalls: unknown[] = [];
  const secondCalls: unknown[] = [];
  const makeProvider = (calls: unknown[]): BrowserProvider => ({
    isMetaMask: true,
    request: async (request) => {
      calls.push(request);
      throw Object.assign(new Error("fixture stop"), { code: 4001 });
    },
  });
  const info = { name: "<img src=x onerror=attack>\u202e", rdns: "io.metamask", uuid: "duplicate-uuid", icon: "data:image/svg+xml,hostile" };
  const browser = await runServedBrowser({
    announcements: [
      { info, provider: makeProvider(firstCalls) },
      { info, provider: makeProvider(secondCalls) },
    ],
  });
  await waitFor(() => browser.document.buttons().length > 0 || browser.posts.length > 0, "duplicate provider choices");
  assert.equal(firstCalls.length + secondCalls.length, 0);
  assert.equal(browser.document.buttons().length, 2);
  assert.equal(browser.document.innerHtmlWrites, 0);
  assert.match(browser.document.buttons()[1]?.textContent ?? "", /<img src=x onerror=attack>/u);
  assert.doesNotMatch(browser.document.buttons()[1]?.textContent ?? "", /\u202e/u);
  assert.doesNotMatch(browser.document.buttons()[1]?.textContent ?? "", /data:image/u);
  browser.document.buttons()[1]?.click();
  await waitFor(() => browser.posts.length > 0, "clicked duplicate provider result");
  assert.equal(firstCalls.length, 0);
  assert.equal(secondCalls.length, 1);
  assert.equal(browser.document.buttons().every((choice) => choice.disabled), true);
});

test("served browser requires an explicit click for one legacy MetaMask-flagged provider", async () => {
  const calls: unknown[] = [];
  const provider: BrowserProvider = {
    isMetaMask: true,
    request: async (request) => {
      calls.push(request);
      throw Object.assign(new Error("fixture stop"), { code: 4001 });
    },
  };
  const browser = await runServedBrowser({ ethereum: { providers: [provider] } });
  await waitFor(() => browser.document.buttons().length > 0 || calls.length > 0 || browser.posts.length > 0, "legacy provider choice");
  assert.equal(calls.length, 0, "legacy flags cannot authorize silent selection");
  assert.equal(browser.document.buttons().length, 1);
  assert.match(browser.document.buttons()[0]?.textContent ?? "", /Source: Legacy ethereum\.providers/u);
  assert.match(browser.document.buttons()[0]?.textContent ?? "", /Name: Unavailable; RDNS: Unavailable; UUID: Unavailable/u);
  assert.match(browser.document.buttons()[0]?.textContent ?? "", /unverified/iu);
  browser.document.buttons()[0]?.click();
  await waitFor(() => browser.posts.length > 0, "legacy provider result");
  assert.equal(calls.length, 1);
});

test("served browser preserves missing-provider fail-closed behavior", async () => {
  const browser = await runServedBrowser({});
  await waitFor(() => browser.posts.length > 0, "missing-provider result");
  assert.deepEqual(browser.posts[0], {
    token: "a".repeat(64),
    outcome: { ok: false, code: "missing_provider", diagnostic: { step: "provider_choice", permission_requested: false, provider_code: null, provider_message: null } },
  });
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
  await assert.rejects(consent.request({ ...REQUEST, port: await allocateConsentPort() }), (error: any) => error.code === "APN_PROVIDER_PROTOCOL");
  assert.equal(secondAttemptAccepted, false);
});

test("loopback consent deadline also bounds a browser opener that never resolves", async () => {
  const consent = new LoopbackMetaMaskConsent(async () => await new Promise<void>(() => undefined), 10);
  const started = Date.now();
  await assert.rejects(consent.request({ ...REQUEST, port: await allocateConsentPort() }), (error: any) =>
    error.code === "APN_PROVIDER_UNAVAILABLE" && error.details?.retryable === true
  );
  assert.ok(Date.now() - started < 1_000);
});

test("loopback consent refuses the exact callback after its deadline", async () => {
  let opened!: URL;
  const consent = new LoopbackMetaMaskConsent(async (openedUrl) => {
    opened = new URL(openedUrl);
  }, 10);
  await assert.rejects(consent.request({ ...REQUEST, port: await allocateConsentPort() }), (error: any) =>
    error.code === "APN_PROVIDER_UNAVAILABLE" && error.details?.retryable === true
  );
  await assert.rejects(fetch(`${opened.origin}/callback`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: opened.origin },
    body: JSON.stringify({ token: opened.hash.slice(1), outcome: { ok: true, value: {} } }),
  }));
});

test("loopback consent maps browser launch failure without leaking its cause", async () => {
  const consent = new LoopbackMetaMaskConsent(async () => { throw new Error("PROTECTED_CANARY"); }, 1_000);
  await assert.rejects(consent.request({ ...REQUEST, port: await allocateConsentPort() }), (error: any) =>
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
    await assert.rejects(consent.request({ ...REQUEST, port: await allocateConsentPort() }), (error: any) => error.code === "APN_PROVIDER_PROTOCOL");
  }
});
