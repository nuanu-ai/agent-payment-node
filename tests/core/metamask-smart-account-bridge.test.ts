import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { LoopbackMetaMaskConsent } from "../../src/metamask-smart-account-consent.js";
import type { Address } from "../../src/model.js";

const SESSION = "0x2222222222222222222222222222222222222222" as Address;
const REQUEST = {
  sessionAddress: SESSION,
  capAtomic: "2000000",
  startsAtUnix: 1_788_393_600,
  expiresAtUnix: 1_788_397_200,
};

interface BrowserProvider {
  readonly isMetaMask?: boolean;
  readonly isRabby?: boolean;
  readonly isBraveWallet?: boolean;
  readonly request: (request: unknown) => Promise<unknown>;
}

interface ProviderAnnouncement {
  readonly info: {
    readonly name?: string;
    readonly rdns?: string;
    readonly uuid?: string;
    readonly icon?: string;
  };
  readonly provider: BrowserProvider;
}

class FakeElement {
  public textContent = "";
  public disabled = false;
  public type = "";
  public readonly children: FakeElement[] = [];
  private readonly listeners = new Map<string, Array<() => void>>();

  public constructor(
    public readonly tagName: string,
    private readonly noteInnerHtmlWrite: () => void,
  ) {}

  public set innerHTML(_value: string) { this.noteInnerHtmlWrite(); }

  public appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }

  public append(...children: FakeElement[]): void { this.children.push(...children); }

  public addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  public click(): void {
    if (this.disabled) return;
    for (const listener of this.listeners.get("click") ?? []) listener();
  }
}

class FakeDocument {
  public innerHtmlWrites = 0;
  public readonly status = new FakeElement("p", () => { this.innerHtmlWrites += 1; });
  public readonly providers = new FakeElement("ol", () => { this.innerHtmlWrites += 1; });
  private readonly created: FakeElement[] = [];

  public getElementById(id: string): FakeElement {
    if (id === "status") return this.status;
    if (id === "providers") return this.providers;
    throw new Error(`unexpected element id: ${id}`);
  }

  public createElement(tagName: string): FakeElement {
    const element = new FakeElement(tagName, () => { this.innerHtmlWrites += 1; });
    this.created.push(element);
    return element;
  }

  public buttons(): FakeElement[] {
    return this.created.filter((element) => element.tagName === "button");
  }
}

let browserAssetsPromise: Promise<{ readonly html: string; readonly script: string }> | undefined;

function servedBrowserAssets(): Promise<{ readonly html: string; readonly script: string }> {
  browserAssetsPromise ??= captureServedBrowserAssets();
  return browserAssetsPromise;
}

async function captureServedBrowserAssets(): Promise<{ readonly html: string; readonly script: string }> {
  const expected = { bridge: "test-assets" };
  let assets: { readonly html: string; readonly script: string } | undefined;
  const consent = new LoopbackMetaMaskConsent(async (openedUrl) => {
    const opened = new URL(openedUrl);
    const [pageResponse, scriptResponse] = await Promise.all([
      fetch(`${opened.origin}/`),
      fetch(`${opened.origin}/app.js`),
    ]);
    assets = { html: await pageResponse.text(), script: await scriptResponse.text() };
    const callback = await fetch(`${opened.origin}/callback`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: opened.origin },
      body: JSON.stringify({ token: opened.hash.slice(1), outcome: { ok: true, value: expected } }),
    });
    assert.equal(callback.status, 204);
  }, 1_000);
  assert.deepEqual(await consent.request(REQUEST), expected);
  if (assets === undefined) throw new Error("served browser assets were not captured");
  return assets;
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail(`timed out waiting for ${label}`);
}

async function runServedBrowser(options: {
  readonly announcements?: readonly ProviderAnnouncement[];
  readonly ethereum?: BrowserProvider | { readonly providers: readonly BrowserProvider[] };
}) {
  const { script } = await servedBrowserAssets();
  const document = new FakeDocument();
  const posts: unknown[] = [];
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  class FakeEvent { public constructor(public readonly type: string) {} }
  const sandbox: Record<string, unknown> = {
    document,
    location: { hash: `#${"a".repeat(64)}` },
    history: { replaceState: () => undefined },
    Event: FakeEvent,
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      const registered = listeners.get(type) ?? [];
      registered.push(listener);
      listeners.set(type, registered);
    },
    removeEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, (listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
    },
    dispatchEvent: (event: FakeEvent) => {
      for (const listener of listeners.get(event.type) ?? []) listener(event);
      if (event.type === "eip6963:requestProvider") {
        for (const detail of options.announcements ?? []) {
          for (const listener of listeners.get("eip6963:announceProvider") ?? []) {
            listener({ type: "eip6963:announceProvider", detail });
          }
        }
      }
      return true;
    },
    fetch: async (_input: unknown, init?: { readonly body?: string }) => {
      posts.push(JSON.parse(init?.body ?? "null") as unknown);
      return { ok: true, status: 204 };
    },
    setTimeout: (callback: () => void) => setTimeout(callback, 0),
    window: { close: () => undefined },
    console,
  };
  if (options.ethereum !== undefined) sandbox.ethereum = options.ethereum;
  runInNewContext(script, sandbox, { timeout: 1_000 });
  return { document, posts };
}

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
  assert.deepEqual(await consent.request(REQUEST), expected);
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
    outcome: { ok: false, code: "missing_provider" },
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
