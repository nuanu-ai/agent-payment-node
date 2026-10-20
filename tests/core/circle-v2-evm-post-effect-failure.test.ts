/**
 * QA 0.5.51 CIRCLE-POST-BURN-ERROR-STATE-001 (165ef682…, Arbitrum USDC -> Monad): approve-source sent the approval and
 * the burn, then the issuer attestation read failed and the command answered a bare APN_HTTP_CONFIG with no operation.
 * Through the real command path (argv, core, funding service, ledger, local custody signing) over the synthetic CCTP
 * network: a command that sent an effect answers with that operation and names the failed read; nothing is resent.
 */
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress } from "viem";
import { CIRCLE_SOURCE_TOKEN, circleFundingMechanism, circleRoute } from "../../src/circle-v2-evm/catalog.js";
import { SyntheticCctp } from "./circle-v2-evm-any-profile-network.js";

const original = await import(new URL("../../src/tty-approval.js?circle-post-effect-original", import.meta.url).href) as typeof import("../../src/tty-approval.js");
mock.module("../../src/tty-approval.js", { namedExports: { ...original, exactChainConsent: async () => undefined } });
const { runCli } = await import("../../src/cli.js");
const { StateStore } = await import("../../src/state.js");
const { TtyAllowlistPolicyApproval } = await import("../../src/allowlist-policy-activation.js");
const { CircleFundingEvmService } = await import("../../src/circle-v2-evm/funding-runtime.js");

const CHAIN = 143, BENEFICIARY = getAddress(`0x${"5a".repeat(20)}`);
const wrapping = { load: async () => Buffer.alloc(32, 7), create: async () => Buffer.alloc(32, 7) };
type Effect = { role: string; phase: string; transaction_hash: string | null };
type PublicOperation = { operation_id: string; state: string; terminal: boolean; effects: Effect[]; observation_failure?: Record<string, unknown> };

async function setup(t: test.TestContext) {
  const base = await mkdtemp(join(await realpath(tmpdir()), "circle-post-effect-")), root = join(base, "state"); t.after(() => rm(base, { recursive: true, force: true }));
  const net = new SyntheticCctp(CHAIN), mechanism = circleFundingMechanism(CHAIN);
  const ensure = async (profile: string) => { const r = await runCli(["wallet", "ensure", "--profile", profile], {}, { stateRoot: root, wrappingSecret: wrapping }); assert.equal(r.ok, true, JSON.stringify(r.error)); return getAddress((r.data as { address: string }).address); };
  const source = await ensure("cctp-src"), gas = await ensure("cctp-gas");
  net.arbitrum.native.set(source.toLowerCase(), 10n ** 16n); net.arbitrum.usdc.set(source.toLowerCase(), 5_000_000n); net.destination.native.set(gas.toLowerCase(), 10n ** 18n);
  const activate = async (profile: string, account: string, admissions: Record<string, unknown>[]) => {
    const now = Date.now(), file = join(base, `${profile}-policy.json`);
    await writeFile(file, JSON.stringify({ schemaVersion: "apn.allowlist-policy-file.v1", overlayVersion: `synthetic.${profile}.1`, accounts: { evm: account },
      effectiveAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 3_600_000).toISOString(), admissions }), { mode: 0o600 });
    assert.equal((await runCli(["allowlist", "policy", "stage", "--profile", profile, "--file", file], {}, { stateRoot: root })).ok, true);
    let screen = "";
    const approval = new TtyAllowlistPolicyApproval({ isTerminal: () => true, openTerminal: async () => ({ fd: 11, write: async (s: string) => { screen += s; },
      read: async function* () { yield Buffer.from(`${[...screen.matchAll(/Type ([a-f0-9]{6})/gu)].at(-1)![1]!}\n`); }, close: async () => {} }) });
    assert.equal((await runCli(["allowlist", "policy", "activate", "--profile", profile, "--revision", "1"], {}, { stateRoot: root, allowlistPolicyApproval: approval })).ok, true);
  };
  await activate("cctp-src", source, [
    { chain: "eip155:42161", kind: "token", identifier: CIRCLE_SOURCE_TOKEN, rail: "bridge", maximumPerTransferAtomic: "10000000", dailyLimitAtomic: "20000000", mechanism },
    { chain: "eip155:42161", kind: "native", rail: "bridge", maximumPerTransferAtomic: "30000000000000", dailyLimitAtomic: "1000000000000000", mechanism }]);
  await activate("cctp-gas", gas, [{ chain: `eip155:${CHAIN}`, kind: "native", rail: "bridge", maximumPerTransferAtomic: circleRoute(CHAIN).destinationNativeCap,
    dailyLimitAtomic: "1000000000000000000", mechanism }]);
  const service = new CircleFundingEvmService(new StateStore(root), wrapping, net.env, Date.now, {}, net.https);
  const cli = async (args: readonly string[]) => await runCli(["circle", "evm", ...args], {}, { stateRoot: root, wrappingSecret: wrapping, circleFundingEvm: service });
  const prepared = await cli(["prepare", "--profile", "cctp-src", "--destination-profile", "cctp-gas", "--destination-chain", String(CHAIN), "--idempotency-key", "post-effect-01",
    "--beneficiary", BENEFICIARY, "--gross-atomic", "1000000", "--max-issuer-fee-atomic", "1000", "--min-mint-atomic", "999000"]);
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  const id = (prepared.operation as PublicOperation).operation_id, request = net.https.request;
  return { net, cli, id, request };
}
const phases = (op: PublicOperation) => Object.fromEntries(op.effects.map((e) => [e.role, [e.phase, e.transaction_hash !== null]]));

test("a burn sent before the issuer read fails answers with the same operation, its hashes and the observe step; observe then mints once", async (t) => {
  const f = await setup(t); let refused = 0;
  f.net.https.request = async (url, method, body) => url.startsWith("https://iris-api.circle.com/v2/messages/") && refused++ === 0
    ? { status: 503, body: "upstream unavailable https://secret.example/token" } : await f.request(url, method, body);
  const burned = await f.cli(["approve-source", "--operation", f.id]); assert.equal(burned.ok, true, JSON.stringify(burned.error));
  const op = burned.operation as PublicOperation;
  assert.deepEqual([op.operation_id, op.state, op.terminal], [f.id, "awaiting_mint", false]);
  assert.deepEqual(phases(op), { approval: ["confirmed", true], burn: ["confirmed", true] });
  assert.deepEqual(op.observation_failure, { stage: "after_effect_sent", code: "APN_PROVIDER_UNAVAILABLE", reason: "issuer_http_status", http_status: 503 });
  assert.ok(burned.next_actions.includes(`apn circle evm observe --operation ${f.id}`));
  assert.equal(JSON.stringify(burned).includes("secret.example"), false); assert.equal(f.net.arbitrum.sends, 2);
  // The same source command again only observes: nothing of the source is signed or sent twice.
  const again = await f.cli(["approve-source", "--operation", f.id]); assert.equal(again.ok, true, JSON.stringify(again.error));
  assert.equal(f.net.arbitrum.sends, 2); assert.equal((again.operation as PublicOperation).observation_failure, undefined);
  const minted = await f.cli(["approve-mint", "--operation", f.id]); assert.equal(minted.ok, true, JSON.stringify(minted.error));
  let done = minted.operation as PublicOperation;
  for (let i = 0; i < 3 && !done.terminal; i++) done = (await f.cli(["observe", "--operation", f.id])).operation as PublicOperation;
  assert.deepEqual([done.state, f.net.arbitrum.sends, f.net.destination.sends], ["completed", 2, 1]);
});

test("an approval sent before a failed read, and a mint sent before a failed read, each answer with their operation", async (t) => {
  const f = await setup(t); let failAfterSend = true, armed = false;
  f.net.https.request = async (url, method, body) => {
    if (armed && !url.startsWith("https://iris-api.circle.com/") && body?.includes("eth_getTransactionReceipt") === true) { armed = false; throw new Error("synthetic read failure"); }
    const answer = await f.request(url, method, body);
    if (failAfterSend && body?.includes("eth_sendRawTransaction") === true) armed = true;
    return answer;
  };
  const approved = await f.cli(["approve-source", "--operation", f.id]); assert.equal(approved.ok, true, JSON.stringify(approved.error));
  const afterApproval = approved.operation as PublicOperation;
  assert.deepEqual([afterApproval.operation_id, phases(afterApproval).approval![1], phases(afterApproval).burn], [f.id, true, ["prepared", false]]);
  assert.equal(afterApproval.observation_failure?.stage, "after_effect_sent"); assert.equal(f.net.arbitrum.sends, 1);
  failAfterSend = false;
  let current = afterApproval;
  for (let i = 0; i < 3 && current.state !== "awaiting_mint"; i++) {
    const next = await f.cli(["approve-source", "--operation", f.id]); assert.equal(next.ok, true, JSON.stringify(next.error)); current = next.operation as PublicOperation;
  }
  assert.deepEqual([current.state, f.net.arbitrum.sends], ["awaiting_mint", 2], "the approval is observed, never signed again; the burn is sent once");
  failAfterSend = true;
  const minted = await f.cli(["approve-mint", "--operation", f.id]); assert.equal(minted.ok, true, JSON.stringify(minted.error));
  const afterMint = minted.operation as PublicOperation;
  assert.deepEqual([phases(afterMint).mint![1], afterMint.observation_failure?.stage, f.net.destination.sends], [true, "after_effect_sent", 1]);
  failAfterSend = false;
  let done = afterMint;
  for (let i = 0; i < 4 && !done.terminal; i++) done = (await f.cli(["observe", "--operation", f.id])).operation as PublicOperation;
  assert.deepEqual([done.state, f.net.arbitrum.sends, f.net.destination.sends], ["completed", 2, 1]);
});

test("a failure before anything is sent still answers as a refusal without an operation", async (t) => {
  const f = await setup(t);
  f.net.https.request = async () => { throw new Error("synthetic outage"); };
  const refused = await f.cli(["approve-source", "--operation", f.id]);
  assert.equal(refused.ok, false); assert.equal(refused.operation, null); assert.equal(f.net.arbitrum.sends, 0);
});
