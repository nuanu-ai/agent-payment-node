import assert from "node:assert/strict";
import test from "node:test";
import { getAddress, hashTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hashObject } from "../../src/canonical.js";
import { allowlistProfileHash } from "../../src/allowlist-policy-overlay.js";
import { sealAssetPolicyRegistry, type UnsignedAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { UsdtBoundOperationRepository } from "../../src/gasless-usdt/bound-operation.js";
import { UsdtExecutionJournal } from "../../src/gasless-usdt/execution-journal.js";
import { LocalUsdtSigningService, verifySignedUsdtOperation } from "../../src/gasless-usdt/local-signing.js";
import { GuardedUsdtSendService } from "../../src/gasless-usdt/send.js";
import { USDT_GASLESS } from "../../src/gasless-usdt/model.js";
import { preparePolicyBoundUsdt } from "../../src/gasless-usdt/policy-prepare.js";
import { usdtUserOperationHash, usdtUserOperationTypedData } from "../../src/gasless-usdt/userop.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

const KEY = `0x${"01".repeat(32)}` as const;
const WRONG_KEY = `0x${"02".repeat(32)}` as const;
const OWNER = privateKeyToAccount(KEY).address;
const RECIPIENT = getAddress("0x000000000000000000000000000000000000dEaD");
const NOW = new Date((0x6aacecdb - 300) * 1000);
const PAYMASTER_DATA = "0x020000006aacecdb000000000000dac17f958d2ee523a2206206994597c13d831ec700000000000000000000000000004c2c00000000000000000000000000000000000000000000000000000000a38ca6e3000000000000000000000000000138804337ff05c84b9a80ea0a78dbe7b8e102f66d4c08972391719016554aea7ecb13e50f38e455f67da2908c40238d37d162d3f3dc686067c76c198b6239400746330724b6191afa40a35538022086b0288210f55e1c1c";
class Wrapping implements WrappingSecretPort {
  async load() { return Buffer.alloc(32, 17); }
  async create() { return Buffer.alloc(32, 17); }
}

async function setup(key: typeof KEY | typeof WRONG_KEY = KEY, delegation: "empty" | "expected" = "empty") {
  const temporary = await temporaryState();
  const state = new StateStore(temporary.root);
  await state.initialize();
  const wrapping = new Wrapping();
  await new EncryptedWalletStore(state, wrapping).importNew("owner", key, privateKeyToAccount(key).address);
  const unsigned: UnsignedAssetPolicyRegistry = { schemaVersion: "apn.asset-policy-registry.v2", registryVersion: "owner.1",
    publishedAt: "2026-09-18T00:00:00.000Z", effectiveDate: "2026-09-18", effectiveAt: "2026-09-18T00:00:00.000Z",
    chains: [{ chain: "eip155:1", family: "evm", name: "Ethereum", assets: [{ kind: "token", identifier: USDT_GASLESS.token,
      symbol: "USDT", decimals: 6, rails: { direct: false, gasless: true, x402: false, bridge: false, swap: false },
      railCaps: { gasless: { maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "2000000" } },
      mechanismPins: { gasless: USDT_GASLESS.mechanism } }] }] };
  const registry = sealAssetPolicyRegistry(unsigned);
  const active = { profile: "owner", registry, digest: registry.policyDigest, revision: 1, activationDigest: "a".repeat(64),
    accounts: { evm: OWNER }, activatedAt: "2026-09-18T00:00:00.000Z" };
  const quote = { quotes: [{ paymaster: USDT_GASLESS.paymaster, token: USDT_GASLESS.token, postOpGas: "0x4c2c",
    exchangeRate: "0xa38ca6e3", exchangeRateNativeToUsd: "0x948f68af", balanceSlot: "0x2", allowanceSlot: "0x5" }] };
  const price = { slow: { maxFeePerGas: "0x10ef719d", maxPriorityFeePerGas: "0xbb0de7a" },
    standard: { maxFeePerGas: "0x11c8374b", maxPriorityFeePerGas: "0xc468333" },
    fast: { maxFeePerGas: "0x12a0fcf9", maxPriorityFeePerGas: "0xcdc27ec" } };
  const port = { now: () => NOW, activePolicy: async () => active,
    dailyUsage: async () => "0", safeSnapshot: async () => ({ chainId: 1n, blockNumber: 26_002_950n,
      blockHash: `0x${"12".repeat(32)}` as const,
      account: { usdtBalanceAtomic: 1_000_000n, entryPointNonce: 7n, eoaNonce: 31n, delegation } }) };
  const prepared = await preparePolicyBoundUsdt({ prepare: port,
    sponsor: { tokenQuote: async () => quote, gasPrice: async () => price,
      paymasterData: async () => ({ paymaster: USDT_GASLESS.paymaster, paymasterData: PAYMASTER_DATA }) } },
  { profile: "owner", chain: USDT_GASLESS.chain, token: USDT_GASLESS.token, sponsorUrl: USDT_GASLESS.bundlerUrl,
    sender: OWNER, recipient: RECIPIENT, grossAtomic: 1_000_000n, maxFeeAtomic: 500_000n, minReceivedAtomic: 500_000n });
  const bound = await new UsdtBoundOperationRepository(temporary.root).create(allowlistProfileHash("owner"), prepared, "sign-001", NOW);
  const expected = { profile: "owner", profileHash: bound.profileHash, operationId: bound.operationId,
    bindingHash: bound.binding.bindingHash };
  const signer = new LocalUsdtSigningService(state, wrapping, () => NOW);
  return { temporary, bound, expected, signer, port, active };
}

test("local custody signs exact bound UserOperation hash and first-use authorization", async t => {
  const f = await setup(); t.after(f.temporary.cleanup);
  const signed = await f.signer.sign(f.bound, f.expected);
  assert.equal(signed.userOperation.signature.length, 132);
  assert.equal(signed.userOperation.eip7702Auth?.nonce, "0x1f");
  assert.equal(signed.userOperation.callData, f.bound.binding.callData);
  assert.equal(signed.userOperation.paymasterData, f.bound.binding.paymasterData);
  assert.equal(usdtUserOperationTypedData(signed.userOperation).domain.chainId, 1);
  assert.equal(usdtUserOperationTypedData(signed.userOperation).domain.verifyingContract, USDT_GASLESS.entryPoint);
  assert.equal(signed.userOperationHash, hashTypedData(usdtUserOperationTypedData(signed.userOperation)));
  assert.equal(signed.userOperationHash, usdtUserOperationHash(signed.userOperation));
  assert.equal(await verifySignedUsdtOperation(f.bound, signed.userOperation), signed.userOperationHash);
  assert.equal(f.bound.binding.unsignedOperation.signature.length, 132); // v1 estimate remains untouched
  const delegated = await setup(KEY, "expected"); t.after(delegated.temporary.cleanup);
  const delegatedSigned = await delegated.signer.sign(delegated.bound, delegated.expected);
  assert.equal(delegatedSigned.userOperation.eip7702Auth, undefined);
  assert.equal(await verifySignedUsdtOperation(delegated.bound, delegatedSigned.userOperation), delegatedSigned.userOperationHash);
});

test("local signer refuses wrong identity, wallet, expired quote and changed signed wire", async t => {
  const f = await setup(); t.after(f.temporary.cleanup);
  for (const expected of [{ ...f.expected, profile: "other" }, { ...f.expected, profileHash: "0".repeat(64) },
    { ...f.expected, bindingHash: "0".repeat(64) }, { ...f.expected, operationId: "0".repeat(64) }]) {
    await assert.rejects(() => f.signer.sign(f.bound, expected), { code: "APN_WALLET_MISMATCH" });
  }
  const signed = await f.signer.sign(f.bound, f.expected);
  const forgedBody = { ...f.bound, idempotencyKey: "forged-valid-hash",
    operationId: hashObject({ schemaVersion: f.bound.schemaVersion, profileHash: f.bound.profileHash,
      idempotencyKey: "forged-valid-hash", bindingHash: f.bound.binding.bindingHash }) };
  const { integrityHash: _oldHash, ...newBody } = forgedBody;
  const forged = { ...newBody, integrityHash: hashObject(newBody) };
  await assert.rejects(() => f.signer.sign(forged, { ...f.expected, operationId: forged.operationId }),
    { code: "APN_STATE_CORRUPT" });
  const tamper = (path: string, value: unknown) => {
    const copy = structuredClone(f.bound) as Record<string, any>;
    const keys = path.split("."); let at = copy;
    for (const key of keys.slice(0, -1)) at = at[key];
    at[keys.at(-1)!] = value;
    return copy as unknown as typeof f.bound;
  };
  for (const [path, value] of [["binding.chain", "eip155:8453"],
    ["binding.plan.request.sender", RECIPIENT], ["binding.account.entryPointNonce", "8"],
    ["binding.account.eoaNonce", "32"], ["binding.plan.quote.exchangeRate", "100"],
    ["binding.plan.feeCapAtomic", "1"], ["binding.paymasterData", "0x"]] as const) {
    await assert.rejects(() => f.signer.sign(tamper(path, value), f.expected));
  }
  for (const wire of [{ ...signed.userOperation, callData: "0x" as const },
    { ...signed.userOperation, nonce: "0x8" as const },
    { ...signed.userOperation, paymasterData: "0x" as const },
    { ...signed.userOperation, paymaster: RECIPIENT },
    { ...signed.userOperation, eip7702Auth: { ...signed.userOperation.eip7702Auth!, nonce: "0x20" as const } }]) {
    await assert.rejects(() => verifySignedUsdtOperation(f.bound, wire));
  }
  const expired = new LocalUsdtSigningService(new StateStore(f.temporary.root), new Wrapping(),
    () => new Date(NOW.getTime() + 600_000));
  await assert.rejects(() => expired.sign(f.bound, f.expected), { code: "APN_REPREPARE_REQUIRED" });
  const wrong = await setup(WRONG_KEY); t.after(wrong.temporary.cleanup);
  await assert.rejects(() => wrong.signer.sign(wrong.bound, wrong.expected), { code: "APN_WALLET_MISMATCH" });
});

test("guarded send records exact hash before one call and refuses replay", async t => {
  const f = await setup(); t.after(f.temporary.cleanup);
  const journal = new UsdtExecutionJournal(f.temporary.root);
  let calls = 0;
  const send = new GuardedUsdtSendService(journal, f.signer, { async send(op) {
    calls++;
    const before = await journal.load(f.bound.operationId);
    assert.equal(before?.state, "submitting");
    assert.equal(before.userOperationHash, usdtUserOperationHash(op));
    return usdtUserOperationHash(op);
  } }, f.port);
  const result = await send.send(f.bound, f.expected);
  assert.equal(result.state, "submitted_pending"); assert.equal(calls, 1);
  await assert.rejects(() => send.send(f.bound, f.expected), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(calls, 1);
});

test("guarded send treats timeout and mismatching acknowledgement as unknown with no rebroadcast", async t => {
  for (const outcome of ["timeout", "mismatch"] as const) {
    const f = await setup(); t.after(f.temporary.cleanup);
    const journal = new UsdtExecutionJournal(f.temporary.root);
    let calls = 0;
    const send = new GuardedUsdtSendService(journal, f.signer, { async send() {
      calls++;
      if (outcome === "timeout") throw new Error("synthetic timeout");
      return `0x${"ff".repeat(32)}`;
    } }, f.port);
    const result = await send.send(f.bound, f.expected);
    assert.equal(result.state, "unknown_finality"); assert.equal(calls, 1);
    await assert.rejects(() => send.send(f.bound, f.expected), { code: "APN_OPERATION_BLOCKED" });
    assert.equal(calls, 1);
  }
});

test("persisted submitting intent after a pre-send crash blocks every later send", async t => {
  const f = await setup(); t.after(f.temporary.cleanup);
  class Interrupted extends UsdtExecutionJournal {
    override async markSubmitting(...args: Parameters<UsdtExecutionJournal["markSubmitting"]>): ReturnType<UsdtExecutionJournal["markSubmitting"]> {
      const record = await super.markSubmitting(...args);
      throw new Error(`crash after ${record.state}`);
    }
  }
  const journal = new Interrupted(f.temporary.root);
  let calls = 0;
  const send = new GuardedUsdtSendService(journal, f.signer, { async send() { calls++; return `0x${"aa".repeat(32)}`; } }, f.port);
  await assert.rejects(() => send.send(f.bound, f.expected), /crash after submitting/u);
  assert.equal((await journal.load(f.bound.operationId))?.state, "submitting");
  assert.equal(calls, 0);
  await assert.rejects(() => new GuardedUsdtSendService(new UsdtExecutionJournal(f.temporary.root), f.signer,
    { async send() { calls++; return `0x${"aa".repeat(32)}`; } }, f.port).send(f.bound, f.expected), { code: "APN_OPERATION_BLOCKED" });
  assert.equal(calls, 0);
});

test("guarded send blocks changed policy or nonce before any dispatch", async t => {
  for (const drift of ["policy", "nonce"] as const) {
    const f = await setup(); t.after(f.temporary.cleanup);
    const port = { ...f.port, activePolicy: async () => drift === "policy" ? null : f.active,
      safeSnapshot: async (...args: Parameters<typeof f.port.safeSnapshot>) => {
        const snapshot = await f.port.safeSnapshot(...args);
        return drift === "nonce" ? { ...snapshot, account: { ...snapshot.account, entryPointNonce: 8n } } : snapshot;
      } };
    let calls = 0;
    const send = new GuardedUsdtSendService(new UsdtExecutionJournal(f.temporary.root), f.signer,
      { async send() { calls++; return `0x${"aa".repeat(32)}`; } }, port);
    await assert.rejects(() => send.send(f.bound, f.expected), { code: "APN_OPERATION_BLOCKED" });
    assert.equal(calls, 0);
  }
});
