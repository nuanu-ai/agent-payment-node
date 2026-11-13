/** The served Smart Account consent page, run in a VM sandbox with a fake document and a scripted injected provider. */
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { allocateConsentPort, LoopbackMetaMaskConsent } from "../../src/metamask-smart-account-consent.js";
import type { Address } from "../../src/model.js";

export const SESSION = "0x2222222222222222222222222222222222222222" as Address;
export const OWNER = "0x1111111111111111111111111111111111111111" as Address;
export const REQUEST = {
  sessionAddress: SESSION,
  capAtomic: "2000000",
  startsAtUnix: 1_788_393_600,
  expiresAtUnix: 1_788_397_200,
};

export interface BrowserProvider {
  readonly isMetaMask?: boolean;
  readonly isRabby?: boolean;
  readonly isBraveWallet?: boolean;
  readonly request: (request: unknown) => Promise<unknown>;
}

export interface ProviderAnnouncement {
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

export class FakeDocument {
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

/** "request" is a first consent; "request-retry" is a retry of the same intent, which first reads held grants. */
type ServedMode = "request" | "request-retry" | "sync";
const browserAssets = new Map<ServedMode, Promise<{ readonly html: string; readonly script: string }>>();

/** The page and script the CLI serves for one consent mode, captured once per mode through a real loopback consent. */
export function servedBrowserAssets(mode: ServedMode = "request"): Promise<{ readonly html: string; readonly script: string }> {
  const captured = browserAssets.get(mode) ?? captureServedBrowserAssets(mode);
  browserAssets.set(mode, captured);
  return captured;
}

async function captureServedBrowserAssets(mode: ServedMode): Promise<{ readonly html: string; readonly script: string }> {
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
  assert.deepEqual(mode === "sync" ? await consent.sync({ port: await allocateConsentPort(), ownerAddress: OWNER })
    : await consent.request({ ...REQUEST, port: await allocateConsentPort(), retry: mode === "request-retry" }), expected);
  if (assets === undefined) throw new Error("served browser assets were not captured");
  return assets;
}

export async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.fail(`timed out waiting for ${label}`);
}

export async function runServedBrowser(options: {
  readonly announcements?: readonly ProviderAnnouncement[];
  readonly ethereum?: BrowserProvider | { readonly providers: readonly BrowserProvider[] };
  readonly mode?: ServedMode;
}) {
  const { script } = await servedBrowserAssets(options.mode);
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
