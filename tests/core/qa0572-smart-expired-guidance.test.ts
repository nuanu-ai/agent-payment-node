/**
 * QA 0.5.72 SMART-PENDING-EXPIRED-RETRY-GUIDANCE-072-001: after a pending MetaMask Smart Account intent expired, `wallet
 * status` and `wallet permission list` still advised the exact connect retry, which is refused before consent ("The
 * pending permission intent expired before consent.", no next actions). The guidance now follows the intent's expiry, and
 * the refusal carries it. The pending intent, its session and cap stay unchanged; no consent is requested.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { privateKeyToAccount } from "viem/accounts";
import * as cliRuntime from "../../src/cli.js";
import * as mcpRuntime from "../../src/mcp-server.js";
import type { OutputEnvelope } from "../../src/commands.js";
import * as errorRuntime from "../../src/errors.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import type { Address, Hex } from "../../src/model.js";
import { METAMASK_SMART_ACCOUNT_PROVIDER_ID } from "../../src/metamask-smart-account-adapter.js";
import { testRuntime } from "./installed-runtime.js";
import { temporaryState } from "./helpers.js";

const { runCli } = await testRuntime(cliRuntime, "cli.js");
const { createMcpServer } = await testRuntime(mcpRuntime, "mcp-server.js");
const { ApnError } = await testRuntime(errorRuntime, "errors.js");
const SESSION_KEY = `0x${"2".repeat(64)}` as Hex, SESSION = privateKeyToAccount(SESSION_KEY).address as Address;
const NOW = 1_788_393_600, EXPIRY = NOW + 3_600, PROFILE = "smart-account", KEY = "smart-account-connect-0001";
const CONNECT = ["wallet", "connect", "--profile", PROFILE, "--provider", METAMASK_SMART_ACCOUNT_PROVIDER_ID, "--auth-method", "browser",
  "--permission-cap-usdc-atomic", "2000000", "--permission-expires-at", String(EXPIRY), "--idempotency-key", KEY];
const EXPIRED = [
  `The intent expired at ${new Date(EXPIRY * 1000).toISOString()} and its exact connect is refused. In MetaMask, check whether a permission for session ${SESSION} was granted, and revoke it there if it is not wanted.`,
  `Then cancel only the local expired intent with apn wallet permission forget --profile ${PROFILE} --expected-revision 1, and start a new wallet connect with a new expiry and idempotency key.`,
];

class Wrapping implements WrappingSecretPort {
  async load(): Promise<Buffer | null> { return Buffer.from("33".repeat(32), "hex"); }
  async create(): Promise<Buffer> { return Buffer.from("33".repeat(32), "hex"); }
}
/** MetaMask consent that times out, which leaves the intent pending; it counts every request. */
class TimingOutConsent {
  requests = 0;
  async request(): Promise<unknown> {
    this.requests += 1;
    throw new ApnError("APN_PROVIDER_UNAVAILABLE", "MetaMask foreground consent timed out safely; retry the same connect intent.", { retryable: true });
  }
  async sync(): Promise<unknown> { throw new Error("no sync expected"); }
}

test("a pending Smart Account intent advises the exact retry while live and the review, forget and new intent once expired", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  let now = NOW;
  const consent = new TimingOutConsent(), options = { stateRoot: temporary.root, wrappingSecret: new Wrapping(), smartAccountConsent: consent,
    smartAccountSessionKeys: { create: () => ({ address: SESSION, privateKey: SESSION_KEY }) }, clock: { now: () => new Date(now * 1000) } };
  assert.equal((await runCli(CONNECT, {}, options as never)).error?.code, "APN_PROVIDER_UNAVAILABLE");
  const live = await runCli(["wallet", "permission", "list", "--profile", PROFILE], {}, options as never);
  assert.equal((live.data as { permission: { expired: boolean } }).permission.expired, false);
  assert.match(live.next_actions[0]!, /^Retry wallet connect with the exact original provider/u);

  now = EXPIRY + 60;
  const status = await runCli(["wallet", "status", "--profile", PROFILE], {}, options as never);
  const server = createMcpServer(options as never), [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(b);
  const client = new Client({ name: "qa0572-smart-expired", version: "1" }); await client.connect(a);
  t.after(async () => { await client.close(); await server.close(); });
  const listed = (await client.callTool({ name: "apn_wallet_permission_list", arguments: { profile: PROFILE } })).structuredContent as unknown as OutputEnvelope;
  for (const envelope of [status, listed]) {
    const data = envelope.data as { status: string; revision: number; permission: { expired: boolean; session_account: string; requested_cap_usdc_atomic: string }; warning: string };
    assert.deepEqual([data.status, data.revision, data.permission.expired, data.permission.session_account, data.permission.requested_cap_usdc_atomic],
      ["pending_consent", 1, true, SESSION, "2000000"], JSON.stringify(envelope));
    assert.match(data.warning, /expired before consent was confirmed/u);
    assert.deepEqual(envelope.next_actions, EXPIRED);
  }

  const refused = await runCli(CONNECT, {}, options as never);
  assert.deepEqual([refused.error?.code, refused.error?.details?.reason], ["APN_INVALID_INPUT", "permission_intent_expired"]);
  assert.deepEqual(refused.next_actions, EXPIRED);
  assert.equal(consent.requests, 1, "no consent is requested for the expired intent");
  const after = await runCli(["wallet", "permission", "list", "--profile", PROFILE], {}, options as never);
  assert.deepEqual([(after.data as { revision: number }).revision, after.next_actions], [1, EXPIRED]);
});
