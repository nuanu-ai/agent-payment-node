/**
 * SYNTHETIC end-to-end: QA CIRCLE-BRIDGE-003..010 (CCTP V2 Fast, Arbitrum USDC to Sei, Linea or Monad) for profiles that
 * are not the owner's, through the real command path: argv parse, bind, core dispatch, the funding service, owner policy
 * admission, usage ledger, local custody signing, public JSON-RPC and issuer API. Generated keys, a temporary state and
 * the synthetic network in circle-v2-evm-any-profile-network.ts; no live RPC, no funds. Only the foreground TTY prompt is
 * a TEST port (the funding service accepts no injected terminal), and it records the screen it was shown.
 */
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress } from "viem";
import { CIRCLE_SOURCE_TOKEN, circleFundingMechanism, circleRoute, type CircleDestinationChain } from "../../src/circle-v2-evm/catalog.js";
import { SyntheticCctp } from "./circle-v2-evm-any-profile-network.js";

const screens: string[] = [];
const original = await import(new URL("../../src/tty-approval.js?circle-any-profile-original", import.meta.url).href) as typeof import("../../src/tty-approval.js");
mock.module("../../src/tty-approval.js", { namedExports: { ...original, exactChainConsent: async (lines: readonly string[], phrase: string, expiresAt: string) => {
  assert.ok(phrase.length > 0); assert.ok(Date.now() < Date.parse(expiresAt)); screens.push(lines.join("\n"));
} } });
const { runCli } = await import("../../src/cli.js");
const { StateStore } = await import("../../src/state.js");
const { TtyAllowlistPolicyApproval } = await import("../../src/allowlist-policy-activation.js");
const { CircleFundingEvmService } = await import("../../src/circle-v2-evm/funding-runtime.js");
const { CircleRepository } = await import("../../src/circle-v2-evm/repository.js");
const { AssetUsageLedger } = await import("../../src/asset-usage-ledger.js");
const { hashObject } = await import("../../src/canonical.js");
const { circleFundingFingerprint, sealCircleFundingOperation, validateCircleFundingOperation } = await import("../../src/circle-v2-evm/funding-operation.js");

const OWNER_WALLETS = ["0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14", "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7", "0x991e254B5C8e0AAf6c244eaa2706BAd059809b04", "0xf41170df51aab52aaa04fbc3ff325cf051644aca"].map(a => a.toLowerCase());
const BENEFICIARY = getAddress(`0x${"5a".repeat(20)}`), OTHER = getAddress(`0x${"6b".repeat(20)}`);
const wrapping = { load: async () => Buffer.alloc(32, 7), create: async () => Buffer.alloc(32, 7) };
type Admission = Record<string, unknown>;
const sourceAdmissions = (chain: CircleDestinationChain, extra: Admission = {}): Admission[] => [
  { chain: "eip155:42161", kind: "token", identifier: CIRCLE_SOURCE_TOKEN, rail: "bridge", maximumPerTransferAtomic: "10000000", dailyLimitAtomic: "20000000", mechanism: circleFundingMechanism(chain), ...extra },
  { chain: "eip155:42161", kind: "native", rail: "bridge", maximumPerTransferAtomic: "30000000000000", dailyLimitAtomic: "1000000000000000", mechanism: circleFundingMechanism(chain) }];
const destinationAdmissions = (chain: CircleDestinationChain): Admission[] => [
  { chain: `eip155:${chain}`, kind: "native", rail: "bridge", maximumPerTransferAtomic: circleRoute(chain).destinationNativeCap, dailyLimitAtomic: "1000000000000000000", mechanism: circleFundingMechanism(chain) }];

async function setup(t: test.TestContext, chain: CircleDestinationChain, options: { readonly sameProfile?: boolean; readonly sourceExtra?: Admission; readonly sourceReference?: string } = {}) {
  const base = await mkdtemp(join(await realpath(tmpdir()), "circle-any-profile-")), root = join(base, "state"); t.after(() => rm(base, { recursive: true, force: true }));
  const net = new SyntheticCctp(chain), sourceProfile = `cctp-src-${chain}`, gasProfile = options.sameProfile === true ? sourceProfile : `cctp-gas-${chain}`;
  const ensure = async (profile: string) => { const r = await runCli(["wallet", "ensure", "--profile", profile], {}, { stateRoot: root, wrappingSecret: wrapping }); assert.equal(r.ok, true, JSON.stringify(r.error)); return getAddress((r.data as { address: string }).address); };
  const source = await ensure(sourceProfile), gas = options.sameProfile === true ? source : await ensure(gasProfile);
  for (const wallet of [source, gas]) assert.ok(!OWNER_WALLETS.includes(wallet.toLowerCase()));
  net.arbitrum.native.set(source.toLowerCase(), 10n ** 16n); net.arbitrum.usdc.set(source.toLowerCase(), 5_000_000n); net.destination.native.set(gas.toLowerCase(), 10n ** 18n);
  const activate = async (profile: string, account: string, admissions: Admission[]) => {
    const now = Date.now(), file = join(base, `${profile}-policy.json`);
    await writeFile(file, JSON.stringify({ schemaVersion: "apn.allowlist-policy-file.v1", overlayVersion: `synthetic.${profile}.1`, accounts: { evm: account },
      effectiveAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 3_600_000).toISOString(), admissions }), { mode: 0o600 });
    const staged = await runCli(["allowlist", "policy", "stage", "--profile", profile, "--file", file], {}, { stateRoot: root }); assert.equal(staged.ok, true, JSON.stringify(staged.error));
    let screen = "";
    const approval = new TtyAllowlistPolicyApproval({ isTerminal: () => true, openTerminal: async () => ({ fd: 11, write: async (s: string) => { screen += s; },
      read: async function* () { yield Buffer.from(`${[...screen.matchAll(/Type ([a-f0-9]{6})/gu)].at(-1)![1]!}\n`); }, close: async () => {} }) });
    const activated = await runCli(["allowlist", "policy", "activate", "--profile", profile, "--revision", "1"], {}, { stateRoot: root, allowlistPolicyApproval: approval });
    assert.equal(activated.ok, true, JSON.stringify(activated.error));
  };
  const sourceRows = sourceAdmissions(chain, options.sourceExtra).map(row => options.sourceReference === undefined ? row : { ...row, mechanism: { provider: "circle-cctp-v2", reference: options.sourceReference } });
  await activate(sourceProfile, source, options.sameProfile === true ? [...sourceRows, ...destinationAdmissions(chain)] : sourceRows);
  if (options.sameProfile !== true) await activate(gasProfile, gas, destinationAdmissions(chain));
  const service = new CircleFundingEvmService(new StateStore(root), wrapping, net.env, Date.now, {}, net.https);
  const cli = (args: readonly string[]) => runCli(["circle", "evm", ...args], {}, { stateRoot: root, wrappingSecret: wrapping, circleFundingEvm: service });
  const prepare = (overrides: Record<string, string> = {}) => cli(["prepare", ...Object.entries({ "--profile": sourceProfile, "--destination-profile": gasProfile, "--destination-chain": String(chain),
    "--idempotency-key": `any-profile-${chain}-01`, "--beneficiary": BENEFICIARY, "--gross-atomic": "1000000", "--max-issuer-fee-atomic": "1000", "--min-mint-atomic": "999000", ...overrides }).flat()]);
  return { root, net, source, gas, sourceProfile, gasProfile, cli, prepare };
}
const reason = (r: { readonly error: { readonly details?: Readonly<Record<string, unknown>> } | null }) => r.error?.details?.reason;
type PublicOperation = { operation_id: string; state: string; terminal: boolean; recipient: string; amount_atomic: string; source_profile: string; destination_profile: string };

for (const [chain, sameProfile] of [[1329, false], [59144, false], [143, false], [59144, true]] as const)
test(`CCTP V2 Fast 42161 -> ${chain}${sameProfile ? " (one profile signs both chains)" : ""}: a non-owner profile prepares, burns, mints and completes to its beneficiary`, async t => {
  const f = await setup(t, chain, { sameProfile }); screens.length = 0;
  // The owned mint lands: the command path never scans transmitter logs for someone else's mint.
  let logScans = 0; const request = f.net.https.request;
  f.net.https.request = async (url, method, body) => { if (body?.includes('"eth_getLogs"') === true) logScans++; return request(url, method, body); };
  const prepared = await f.prepare(); assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  const op = prepared.operation as PublicOperation;
  assert.equal(op.state, "awaiting_source"); assert.equal(op.recipient, BENEFICIARY); assert.equal(op.amount_atomic, "1000000");
  assert.equal(op.source_profile, f.sourceProfile); assert.equal(op.destination_profile, f.gasProfile);
  const journal = (await new CircleRepository(f.root).loadAny(op.operation_id))!;
  assert.equal(journal.schemaVersion, "apn.circle-v2-evm-operation.v2");
  if (journal.schemaVersion !== "apn.circle-v2-evm-operation.v2") return;
  assert.deepEqual([journal.funding.sourceProfile, journal.funding.sourceOwner, journal.funding.destinationProfile, journal.funding.gasPayer], [f.sourceProfile, f.source, f.gasProfile, f.gas]);
  assert.equal(journal.funding.mechanism.reference, `circle-v2-evm-fast-42161-${chain}.v2`);
  const replay = await f.prepare(); assert.equal((replay.operation as PublicOperation).operation_id, op.operation_id);
  const burned = await f.cli(["approve-source", "--operation", op.operation_id]); assert.equal(burned.ok, true, JSON.stringify(burned.error));
  assert.equal((burned.operation as PublicOperation).state, "awaiting_mint"); assert.equal(f.net.arbitrum.sends, 2); assert.equal(f.net.arbitrum.usdc.get(f.source.toLowerCase()), 4_000_000n);
  assert.match(screens[0]!, new RegExp(`${f.sourceProfile} / ${f.source}`)); assert.match(screens[0]!, new RegExp(`Beneficiary: ${BENEFICIARY}`)); assert.match(screens[0]!, /Gross USDC: 1000000/);
  const minted = await f.cli(["approve-mint", "--operation", op.operation_id]); assert.equal(minted.ok, true, JSON.stringify(minted.error));
  assert.equal(f.net.destination.sends, 1); assert.deepEqual(f.net.mintedTo, [{ chain, recipient: BENEFICIARY, net: 999_900n, caller: f.gas }]);
  assert.match(screens[1]!, new RegExp(`${f.gasProfile} / ${f.gas} / eip155:${chain}`));
  let done = minted.operation as PublicOperation;
  for (let i = 0; i < 3 && !done.terminal; i++) { const observed = await f.cli(["observe", "--operation", op.operation_id]); assert.equal(observed.ok, true, JSON.stringify(observed.error)); done = observed.operation as PublicOperation; }
  assert.equal(done.state, "completed"); assert.equal(done.terminal, true);
  const status = await f.cli(["status", "--operation", op.operation_id]); assert.equal((status.operation as PublicOperation).state, "completed");
  const closed = (await new CircleRepository(f.root).loadAny(op.operation_id))!;
  for (const row of closed.usage) assert.ok(["finalized", "failed_confirmed_revert"].includes((await new AssetUsageLedger(f.root).load(row, row.reservationId))!.state));
  assert.equal(f.net.arbitrum.sends + f.net.destination.sends, 3, "one approval, one burn, one mint; nothing resent"); assert.equal(logScans, 0);
});

test("an owner recipient pin on the source USDC admission must list the beneficiary (OD-1), at prepare and before the first burn", async t => {
  const refused = await setup(t, 59144, { sourceExtra: { recipients: [OTHER] } });
  const result = await refused.prepare(); assert.equal(result.error?.code, "APN_ALLOWLIST_REFUSED", JSON.stringify(result)); assert.equal(reason(result), "allowlist_recipient_not_admitted");
  assert.equal(refused.net.arbitrum.sends, 0);
  const pinned = await setup(t, 59144, { sourceExtra: { recipients: [OTHER, BENEFICIARY] } });
  const admitted = await pinned.prepare(); assert.equal(admitted.ok, true, JSON.stringify(admitted.error));
  const burned = await pinned.cli(["approve-source", "--operation", (admitted.operation as PublicOperation).operation_id]); assert.equal(burned.ok, true, JSON.stringify(burned.error));
  assert.equal(pinned.net.arbitrum.sends, 2);
});

test("admission is each profile's own policy: a reference for another destination or a cap below gross refuses before any effect", async t => {
  const wrong = await setup(t, 1329, { sourceReference: "circle-v2-evm-fast-42161-143.v2" });
  const result = await wrong.prepare(); assert.equal(result.ok, false); assert.equal(wrong.net.arbitrum.sends, 0);
  const capped = await setup(t, 143);
  const over = await capped.prepare({ "--gross-atomic": "10000001", "--max-issuer-fee-atomic": "1001", "--min-mint-atomic": "9999000" });
  assert.equal(over.ok, false); assert.equal(capped.net.arbitrum.sends, 0);
  const missing = await capped.cli(["prepare", "--profile", capped.sourceProfile, "--destination-profile", capped.gasProfile, "--destination-chain", "143", "--idempotency-key", "any-profile-no-funding"]);
  assert.equal(missing.error?.code, "APN_INVALID_INPUT");
});

test("the stored binding is checked against the operation's own custody; a re-sealed other gas payer is corrupt", async t => {
  const f = await setup(t, 1329), prepared = await f.prepare(); assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  const id = (prepared.operation as PublicOperation).operation_id, path = join(f.root, "circle-v2-evm", `${id}.json`), op = JSON.parse(await readFile(path, "utf8"));
  assert.equal(validateCircleFundingOperation(op).funding.gasPayer, f.gas);
  for (const field of ["gasPayer", "sourceOwner"] as const) {
    // A self-consistent forgery: binding, fee quote and fingerprint all re-sealed; only the custody binding can refuse it.
    const { bindingHash: _h, ...body } = { ...op.funding, [field]: OTHER }, funding = { ...body, bindingHash: hashObject(body) };
    const { integrityHash: _i, ...fee } = { ...op.feeQuote, bindingHash: funding.bindingHash }, changed = { ...op, funding, feeQuote: { ...fee, integrityHash: hashObject(fee) } };
    assert.throws(() => validateCircleFundingOperation(sealCircleFundingOperation({ ...changed, fingerprint: circleFundingFingerprint(changed) })), /funding_identity_binding/);
  }
  assert.throws(() => validateCircleFundingOperation(sealCircleFundingOperation({ ...op, funding: { ...op.funding, destinationProfile: "someone-else" } })));
});
