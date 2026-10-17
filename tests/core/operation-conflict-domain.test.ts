import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { SOLANA_GENESIS } from "../../src/chain-policy.js";
import { ApnCore } from "../../src/core.js";
import { bridgeConflictDomain, SOLANA_BRIDGE_CHAIN_ID, storedOperationDomains } from "../../src/operation-conflict-domain.js";
import { OperationService, type StoredMoneyOperation } from "../../src/operation-service.js";
import { StateStore } from "../../src/state.js";
import { TRON_GENESIS } from "../../src/tron/constants.js";
import { CanonicalDirectTestNative } from "./canonical-direct-native-fixture.js";
import { gaslessFixture } from "./gasless-helpers.js";
import { activateBaseUsdcDirectPolicy, temporaryState, TestClock, TestRpc, WALLET } from "./helpers.js";
import { installLegacyCase } from "./legacy-corpus-readers.js";
import { lifiFixture } from "./lifi-helpers.js";
import { mmFixture, MM_TEST_OWNER } from "./metamask-gasless-helpers.js";
import { tronFixture } from "./tron-helpers.js";

// Every guard below runs on a real state root: real saved journals (fixtures or the released legacy corpus), the real
// operation index under it and each family's own reader. Nothing is faked in OperationService.
const A = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14";
const B = "0xf41170df51aab52aaa04fbc3ff325cf051644aca";
const TRON = "TCikdGHFWNFWBc9ZqtTh2dmma1mnC4CanS";
const SOLANA = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const CORPUS = join("tests", "fixtures", "legacy-corpus");

const blockedOn = (operationId: string, blockingState: string, network: string, account: string) => ({
  code: "APN_OPERATION_BLOCKED", message: "Another money operation for this network and account is not terminal.",
  details: { blockingOperationId: operationId, blockingState, blockingNetwork: network, blockingAccount: account },
});
const profileBlocked = (operationId: string, blockingState: string) => ({ code: "APN_OPERATION_BLOCKED",
  message: "Another money operation for this profile is not terminal.", details: { blockingOperationId: operationId, blockingState } });

async function root(t: test.TestContext): Promise<string> {
  const temporary = await temporaryState(); t.after(temporary.cleanup); return temporary.root;
}
/** The one saved record under a corpus store directory (per-profile directories are walked). */
async function savedRecord(stateRoot: string, directory: string): Promise<Record<string, any>> {
  const walk = async (path: string): Promise<string[]> => (await Promise.all((await readdir(path, { withFileTypes: true }))
    .map(async entry => entry.isDirectory() ? await walk(join(path, entry.name)) : /^[a-f0-9]{64}\.json$/u.test(entry.name) ? [join(path, entry.name)] : [])))
    .flat();
  const [file, ...more] = await walk(join(stateRoot, directory)); assert.ok(file !== undefined && more.length === 0, directory);
  return JSON.parse(await readFile(file, "utf8")) as Record<string, any>;
}

test("an unresolved operation blocks only its own chain and sending account, in every profile", async (t) => {
  const s = await gaslessFixture(await root(t)), { id, operation } = await s.prepare();
  const owner = operation.intent.owner.address, ph = operation.profileHash, service = new OperationService(s.state);
  assert.equal(operation.intent.request.chainId, 8453);
  await service.assertEvmAccountAvailable(ph, 1, owner);
  await service.assertEvmAccountAvailable(ph, 8453, B);
  await service.assertRailAccountAvailable(ph, "tron", TRON);
  await assert.rejects(service.assertEvmAccountAvailable(ph, 8453, owner.toLowerCase()), blockedOn(id, "awaiting_approval", "evm:8453", owner.toLowerCase()));
  await assert.rejects(service.assertEvmAccountAvailable(ph, "8453", owner), blockedOn(id, "awaiting_approval", "evm:8453", owner.toLowerCase()));
  // An exclusive claim also excludes a shared (EIP-3009) one on the same account.
  await assert.rejects(service.assertEvmAccountSharedAvailable(ph, 8453, owner), blockedOn(id, "awaiting_approval", "evm:8453", owner.toLowerCase()));
  // Phase 4b: an account claim is the account's, not the profile's; another profile signing for it waits too.
  await assert.rejects(service.assertEvmAccountAvailable("2".repeat(64), 8453, owner), blockedOn(id, "awaiting_approval", "evm:8453", owner.toLowerCase()));
  await service.assertEvmAccountAvailableExcept(ph, 8453, owner, id);
});

test("wallet lifecycle keeps the whole-profile guard, and an unreadable requested domain fails closed to it", async (t) => {
  const s = await gaslessFixture(await root(t)), { id, operation } = await s.prepare(), service = new OperationService(s.state);
  await assert.rejects(service.assertProfileAvailable(operation.profileHash), profileBlocked(id, "awaiting_approval"));
  await service.assertProfileAvailable("2".repeat(64));
  await assert.rejects(service.assertEvmAccountAvailable(operation.profileHash, 8453, "not-an-address"), profileBlocked(id, "awaiting_approval"));
  await assert.rejects(service.assertEvmAccountAvailable(operation.profileHash, 0, A), profileBlocked(id, "awaiting_approval"));
  await service.assertEvmAccountAvailable("2".repeat(64), 8453, "not-an-address");
});

test("terminal operations never block, and their open claim is collected", async (t) => {
  const s = await gaslessFixture(await root(t)), { id, operation } = await s.prepare(), service = new OperationService(s.state);
  await assert.rejects(service.assertProfileAvailable(operation.profileHash), profileBlocked(id, "awaiting_approval"));
  s.approval.accepted = false;
  assert.equal((await s.core.execute({ command: "gasless.transfer.approve", operationId: id })).ok, true);
  assert.equal((await s.record(id)).terminal, true);
  await service.assertEvmAccountAvailable(operation.profileHash, 8453, operation.intent.owner.address);
  await service.assertProfileAvailable(operation.profileHash);
  await assert.rejects(readFile(join(s.state.root, "operation-index", "open", `${id}.json`)), { code: "ENOENT" });
});

test("a MetaMask gasless operation on Base blocks the same address on Base but not on Arbitrum", async (t) => {
  const f = await mmFixture(await root(t)), { id, operation } = await f.prepare(), service = new OperationService(f.state);
  await assert.rejects(service.assertEvmAccountAvailable(operation.profileHash, 8453, MM_TEST_OWNER), blockedOn(id, operation.state, "evm:8453", MM_TEST_OWNER));
  await service.assertEvmAccountAvailable(operation.profileHash, 42161, MM_TEST_OWNER);
});

test("rail operations are scoped by rail genesis and sender", async (t) => {
  const f = await tronFixture(await root(t)), id = await f.prepare(), service = new OperationService(new StateStore(f.core.context.state.root));
  const ph = f.core.context.state.profileHash(f.account.profile);
  await assert.rejects(service.assertRailAccountAvailable(ph, "tron", f.account.address), blockedOn(id, "awaiting_approval", `tron:${TRON_GENESIS}`, f.account.address));
  await service.assertRailAccountAvailable(ph, "solana", SOLANA);
  await service.assertEvmAccountAvailable(ph, 8453, A);
});

test("an EVM bridge holds its source chain account only", async (t) => {
  const f = await lifiFixture(await root(t)), { id, operation } = await f.prepare(), service = new OperationService(f.state);
  const owner = operation.intent.owner.address, chain = operation.intent.sourceDeployment.chainId;
  await assert.rejects(service.assertEvmAccountAvailable(operation.profileHash, chain, owner), blockedOn(id, operation.state, `evm:${chain}`, owner.toLowerCase()));
  await service.assertEvmAccountAvailable(operation.profileHash, chain === 8453 ? 1 : 8453, owner);
  await service.assertRailAccountAvailable(operation.profileHash, "solana", SOLANA);
});

test("the bridge domain refuses an account that is not its chain's own account form", () => {
  assert.deepEqual(bridgeConflictDomain(SOLANA_BRIDGE_CHAIN_ID, SOLANA), { family: "solana", network: SOLANA_GENESIS, account: SOLANA });
  assert.deepEqual(bridgeConflictDomain(8453, A), { family: "evm", network: "8453", account: A.toLowerCase() });
  assert.deepEqual(bridgeConflictDomain("42161", B), { family: "evm", network: "42161", account: B });
  // An EVM address on the Solana chain id, and a base58 address on an EVM chain id, are both refused.
  assert.throws(() => bridgeConflictDomain(SOLANA_BRIDGE_CHAIN_ID, A), /Invalid Solana bridge conflict domain/u);
  assert.throws(() => bridgeConflictDomain(SOLANA_BRIDGE_CHAIN_ID, "not-base58"), /Invalid Solana bridge conflict domain/u);
  assert.throws(() => bridgeConflictDomain(8453, SOLANA), /Invalid EVM conflict domain/u);
  assert.throws(() => bridgeConflictDomain(0, A), /Invalid EVM conflict domain/u);
});

test("every stored money family maps to its network and sending account", () => {
  const domains = (operation: unknown) => storedOperationDomains(operation as StoredMoneyOperation);
  const evm = (network: string, account: string) => [{ family: "evm", network, account: account.toLowerCase() }];
  const open = (fields: Readonly<Record<string, unknown>>) => ({ operationId: "x", state: "unknown_finality", terminal: false, ...fields });
  const bridgeOn = (chainId: number | string, address: string) => open({ intent: { sourceDeployment: { chainId }, owner: { address } } });
  assert.deepEqual(domains({ kind: "direct_transfer", record: open({ chainId: 42161, walletAddress: A }) }), evm("42161", A));
  assert.deepEqual(domains({ kind: "relay_unsigned", record: open({ sourceChainId: 1, sourceAccount: A }) }), evm("1", A));
  const offer = (assetTransferMethod: string) => ({ selectedOffer: { resolved: { assetTransferMethod } } });
  assert.deepEqual(domains({ kind: "x402_fetch", strategy: "local", record: open({ chainId: "10", wallet: A.toLowerCase(), ...offer("erc7710") }) }), evm("10", A));
  assert.deepEqual(domains({ kind: "x402_fetch", strategy: "local", record: open({ chainId: "10", wallet: A.toLowerCase(), ...offer("eip3009") }) }),
    [{ ...evm("10", A)[0], shared: true }]);
  assert.deepEqual(domains({ kind: "x402_fetch", strategy: "provider_atomic", record: open({ provider: { payer: B } }) }), evm("8453", B));
  assert.deepEqual(domains({ kind: "rail_transfer", record: open({ account: { rail: "solana", address: SOLANA } }) }),
    [{ family: "solana", network: SOLANA_GENESIS, account: SOLANA }]);
  assert.deepEqual(domains({ kind: "bridge_route", record: bridgeOn(1, A) }), evm("1", A));
  assert.deepEqual(domains({ kind: "bridge_route", record: bridgeOn(SOLANA_BRIDGE_CHAIN_ID, SOLANA) }),
    [{ family: "solana", network: SOLANA_GENESIS, account: SOLANA }]);
  assert.equal(domains({ kind: "bridge_route", record: bridgeOn(SOLANA_BRIDGE_CHAIN_ID, A) }), null);
  assert.deepEqual(domains({ kind: "gasless_transfer", record: open({ intent: { request: { chainId: 137 }, owner: { address: A } } }) }), evm("137", A));
  assert.deepEqual(domains({ kind: "metamask_gasless_transfer", record: open({ intent: { request: { chainId: 8453 }, binding: { address: B } } }) }), evm("8453", B));
  assert.deepEqual(domains({ kind: "smart_account_gasless_transfer", record: open({ intent: { request: { chainId: 8453 }, binding: { ownerAddress: A } } }) }), evm("8453", A));
  assert.deepEqual(domains({ kind: "facilitator_gasless_transfer", record: open({ intent: { request: { chainId: 43114 }, owner: { address: A } } }) }), evm("43114", A));
  assert.deepEqual(domains({ kind: "sei_gaszip", record: open({ owner: { address: A } }) }), [...evm("8453", A), ...evm("1329", A)]);
  assert.deepEqual(domains({ kind: "mega_gaszip", record: open({ owner: { address: A } }) }), evm("8453", A));
  assert.deepEqual(domains({ kind: "merchant_x402", record: open({ custody: { walletAddress: A } }) }), evm("4326", A));
  assert.deepEqual(domains({ kind: "permit2_production", record: open({ material: { wallet: { account: A } } }) }), evm("43114", A));
  assert.deepEqual(domains({ kind: "circle_route", record: open({ sourceCustody: { walletAddress: A }, destinationChain: 1329,
    destinationCustody: { walletAddress: B } }) }), [...evm("42161", A), ...evm("1329", B)]);
  assert.equal(domains({ kind: "gasless_transfer", record: open({ intent: { request: {}, owner: { address: A } } }) }), null);
});

// Persisted cross-rail claims must survive releasing the transient address lock.
test("pending Sei funding and a pending Circle Sei route hold their destination domains", async (t) => {
  const stateRoot = await root(t);
  await installLegacyCase(join(CORPUS, "58-v0543-sei-gaszip"), stateRoot);
  await installLegacyCase(join(CORPUS, "23-v0543-circle-v2-evm-funding-runtime"), stateRoot);
  const sei = await savedRecord(stateRoot, "sei-gaszip"), circle = await savedRecord(stateRoot, "circle-v2-evm");
  const service = new OperationService(new StateStore(stateRoot));
  const seiOwner = String(sei.owner.address).toLowerCase(), custody = String(circle.destinationCustody.walletAddress).toLowerCase();
  for (const chain of [8453, 1329]) {
    await assert.rejects(service.assertEvmAccountAvailable(sei.profileHash, chain, seiOwner), blockedOn(sei.operationId, sei.state, `evm:${chain}`, seiOwner));
  }
  await assert.rejects(service.assertEvmAccountAvailable(circle.destinationProfileHash, 1329, custody),
    blockedOn(circle.operationId, circle.state, "evm:1329", custody));
  // The destination profile holds the route as well as the source profile.
  await assert.rejects(service.assertProfileAvailable(circle.destinationProfileHash), { code: "APN_OPERATION_BLOCKED" });
  await service.assertEvmAccountAvailable(sei.profileHash, 4326, seiOwner);
});

test("persisted Mega, Sei, Relay and ordinary Base claims each hold exactly their network and account", async (t) => {
  const claims: { readonly name: string; readonly build: (stateRoot: string) => Promise<{ id: string; state: string; ph: string; chain: number; account: string }> }[] = [
    ...[["33-v0543-mega-gaszip", "mega-gaszip"], ["58-v0543-sei-gaszip", "sei-gaszip"]].map(([corpus, directory]) => ({ name: directory!, build: async (stateRoot: string) => {
      await installLegacyCase(join(CORPUS, corpus!), stateRoot); const r = await savedRecord(stateRoot, directory!);
      return { id: r.operationId, state: r.state, ph: r.profileHash, chain: 8453, account: String(r.owner.address).toLowerCase() };
    } })),
    { name: "relay", build: async stateRoot => {
      await installLegacyCase(join(CORPUS, "49-v0543-relay-base-source-execution"), stateRoot); const r = await savedRecord(stateRoot, "relay-unsigned-operations");
      return { id: r.operationId, state: r.state, ph: r.profileHash, chain: r.sourceChainId, account: String(r.sourceAccount).toLowerCase() };
    } },
    { name: "direct", build: async stateRoot => {
      const state = new StateStore(stateRoot), core = new ApnCore({ state, native: new CanonicalDirectTestNative(stateRoot), rpc: new TestRpc(), clock: new TestClock() });
      assert.equal((await core.execute({ command: "wallet.ensure", profile: "default" })).ok, true);
      await activateBaseUsdcDirectPolicy(stateRoot, WALLET, "default");
      const result = await core.execute({ command: "transfer.prepare", profile: "default", recipient: B, amount: "1", idempotencyKey: "conflict-direct-0001" });
      assert.equal(result.ok, true, JSON.stringify(result.error));
      return { id: (result.operation as { operation_id: string }).operation_id, state: "awaiting_approval", ph: state.profileHash("default"), chain: 8453, account: WALLET.toLowerCase() };
    } },
  ];
  for (const claim of claims) await t.test(claim.name, async sub => {
    const stateRoot = await root(sub), held = await claim.build(stateRoot), service = new OperationService(new StateStore(stateRoot));
    await assert.rejects(service.assertEvmAccountAvailable(held.ph, held.chain, held.account), blockedOn(held.id, held.state, `evm:${held.chain}`, held.account));
    await service.assertEvmAccountAvailable(held.ph, held.chain, held.account === B.toLowerCase() ? A : B);
    await service.assertEvmAccountAvailable(held.ph, 4326, held.account);
  });
});
