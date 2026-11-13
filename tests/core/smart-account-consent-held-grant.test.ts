/**
 * Regression (QA 2026-11-13, 0.5.104): a pending Smart Account connect that MetaMask refused (4100) could only be
 * retried, and each retry asked MetaMask for a new permission without looking at the ones the intent's session key
 * already held, so a consent whose answer never reached APN would be granted twice. The request page now reads
 * `wallet_getGrantedExecutionPermissions` first: a permission to this intent's session key is posted as the answer and
 * no new one is requested; a failed or malformed read stops before any request.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { smartAccountEnvironment } from "../../src/metamask-smart-account-grant.js";
import { OWNER, SESSION, runServedBrowser, waitFor, type BrowserProvider } from "./smart-account-browser-harness.js";

const IMPLEMENTATION = smartAccountEnvironment().implementations.EIP7702StatelessDeleGatorImpl;
if (IMPLEMENTATION === undefined) throw new Error("the pinned EIP-7702 implementation is missing");
const ACTIVE = `0xef0100${IMPLEMENTATION.slice(2)}`;
const SUPPORTED = { "erc20-token-allowance": { chainIds: ["0x2105"], ruleTypes: ["expiry"] } };
const OTHER = "0x3333333333333333333333333333333333333333";
const healthy: Record<string, unknown> = { eth_requestAccounts: [OWNER], eth_accounts: [OWNER], wallet_switchEthereumChain: null,
  eth_chainId: "0x2105", wallet_getSupportedExecutionPermissions: SUPPORTED, eth_getCode: ACTIVE, wallet_requestExecutionPermissions: [{ to: SESSION, fresh: true }] };

async function page(granted: () => unknown) {
  const methods: string[] = [];
  const provider: BrowserProvider = { request: async (request) => {
    const method = (request as { method: string }).method;
    methods.push(method);
    return method === "wallet_getGrantedExecutionPermissions" ? granted() : healthy[method];
  } };
  const browser = await runServedBrowser({ ethereum: provider });
  await waitFor(() => browser.document.buttons().length > 0, "provider choice");
  browser.document.buttons()[0]?.click();
  await waitFor(() => browser.posts.length > 0, "consent result");
  return { methods, outcome: (browser.posts[0] as { outcome: Record<string, any> }).outcome };
}

test("a permission the session key already holds is the answer, and no new permission is requested", async () => {
  const held = { to: SESSION, context: "0x01" };
  const { methods, outcome } = await page(() => [{ to: OTHER, context: "0x02" }, held]);
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.value.permission_responses, [held]);
  assert.equal(outcome.value.owner_address, OWNER);
  assert.ok(!methods.includes("wallet_requestExecutionPermissions"), methods.join(","));
});

test("with no permission to this session key the page requests one", async () => {
  const { methods, outcome } = await page(() => [{ to: OTHER, context: "0x02" }]);
  assert.equal(outcome.ok, true);
  assert.deepEqual(outcome.value.permission_responses, [{ to: SESSION, fresh: true }]);
  assert.ok(methods.indexOf("wallet_getGrantedExecutionPermissions") < methods.indexOf("wallet_requestExecutionPermissions"));
});

test("a refused or malformed read of held permissions stops before any request", async () => {
  const refused = await page(() => { throw Object.assign(new Error("Unauthorized"), { code: 4100 }); });
  assert.deepEqual(refused.outcome, { ok: false, code: "provider_protocol", diagnostic: { step: "wallet_getGrantedExecutionPermissions",
    permission_requested: false, provider_code: 4100, provider_message: "Unauthorized" } });
  assert.ok(!refused.methods.includes("wallet_requestExecutionPermissions"));
  const malformed = await page(() => ({ to: SESSION }));
  assert.deepEqual(malformed.outcome, { ok: false, code: "provider_protocol", diagnostic: { step: "wallet_getGrantedExecutionPermissions",
    permission_requested: false, provider_code: null, provider_message: null } });
  assert.ok(!malformed.methods.includes("wallet_requestExecutionPermissions"));
});
