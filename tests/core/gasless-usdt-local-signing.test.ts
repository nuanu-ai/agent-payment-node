import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, getAddress, hashTypedData, numberToHex, padHex, toEventSelector } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hashObject } from "../../src/canonical.js";
import { allowlistProfileHash } from "../../src/allowlist-policy-overlay.js";
import { sealAssetPolicyRegistry, type UnsignedAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { UsdtBoundOperationRepository } from "../../src/gasless-usdt/bound-operation.js";
import { UsdtExecutionJournal, usdtExecutionIntent } from "../../src/gasless-usdt/execution-journal.js";
import { UsdtRecoveryService, type UsdtRecoveryPort } from "../../src/gasless-usdt/recovery.js";
import { AssetUsageLedger } from "../../src/asset-usage-ledger.js";
import { LocalUsdtSigningService, verifySignedUsdtOperation } from "../../src/gasless-usdt/local-signing.js";
import { GuardedUsdtSendService } from "../../src/gasless-usdt/send.js";
import { GaslessUsdtCommandExecute } from "../../src/gasless-usdt/command-execute.js";
import { runCli } from "../../src/cli.js";
import { MCP_TOOLS } from "../../src/mcp-projection.js";
import { USDT_GASLESS } from "../../src/gasless-usdt/model.js";
import type { UsdtChainReceipt } from "../../src/gasless-usdt/receipt.js";
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

test("CLI gasless USDT execute requires approval and never exposes wallet material", async t => {
  const f = await setup(); t.after(f.temporary.cleanup);
  let sends = 0;
  const argv = ["gasless", "usdt", "execute", "--profile-hash", f.bound.profileHash, "--operation", f.bound.operationId];
  const base = { stateRoot: f.temporary.root, clock: { now: () => NOW }, wrappingSecret: new Wrapping() };
  const denied = await runCli(argv, {}, { ...base, gaslessUsdtExecuteOptions: {
    preparePort: f.port, signer: f.signer, approval: { async approve() { throw new Error("denied"); } },
    sendTransport: { async send() { sends++; return `0x${"ab".repeat(32)}` as const; } },
  } });
  assert.equal(denied.ok, false); assert.equal(sends, 0);
  assert.equal((await new UsdtExecutionJournal(f.temporary.root).load(f.bound.operationId)), null);
  assert.equal(JSON.stringify(denied).includes(KEY.slice(2)), false);
  assert.equal(MCP_TOOLS.some(tool => tool.name === "apn_gasless_usdt_execute"), false);

  const approved = await runCli(argv, {}, { ...base, gaslessUsdtExecuteOptions: {
    preparePort: f.port, signer: f.signer, approval: { async approve(bound) { assert.equal(bound.operationId, f.bound.operationId); } },
    sendTransport: { async send(op) { sends++; return usdtUserOperationHash(op); } },
  } });
  assert.equal(approved.ok, true, JSON.stringify(approved.error));
  assert.equal((approved.operation as { state: string }).state, "submitted_pending");
  assert.equal(sends, 1); assert.equal(JSON.stringify(approved).includes(KEY.slice(2)), false);
  const replay = await runCli(argv, {}, { ...base, gaslessUsdtExecuteOptions: {
    preparePort: f.port, signer: f.signer, approval: { async approve() { throw new Error("should not prompt"); } },
    sendTransport: { async send() { sends++; return `0x${"ab".repeat(32)}` as const; } },
  } });
  assert.equal(replay.error?.code, "APN_OPERATION_BLOCKED"); assert.equal(sends, 1);
});

test("CLI refuses policy and nonce drift before dispatch, and observation never rebroadcasts", async t => {
  for (const drift of ["policy", "nonce", "ambiguous"] as const) {
    const f = await setup(); t.after(f.temporary.cleanup);
    let sends = 0;
    const port = { ...f.port, activePolicy: async () => drift === "policy" ? null : f.active,
      safeSnapshot: async (...args: Parameters<typeof f.port.safeSnapshot>) => {
        const snapshot = await f.port.safeSnapshot(...args);
        return drift === "nonce" ? { ...snapshot, account: { ...snapshot.account, entryPointNonce: 8n } } : snapshot;
      } };
    const service = new GaslessUsdtCommandExecute(new StateStore(f.temporary.root), { now: () => NOW }, new Wrapping(), {
      approval: { async approve() {} }, signer: f.signer, preparePort: port,
      sendTransport: { async send() { sends++; throw new Error("ambiguous send response"); } },
      recoveryPort: { async userOperationReceipt() { return null; }, async canonicalFinalizedReceipt() { throw new Error("unexpected receipt"); } },
    });
    if (drift !== "ambiguous") {
      await assert.rejects(() => service.execute(f.bound.profileHash, f.bound.operationId), { code: "APN_OPERATION_BLOCKED" });
      assert.equal(sends, 0);
    } else {
      const outcome = await service.execute(f.bound.profileHash, f.bound.operationId);
      assert.equal(outcome.state, "unknown_finality"); assert.equal(sends, 1);
      assert.equal((await service.status(f.bound.profileHash, f.bound.operationId)).execution?.state, "unknown_finality");
      assert.equal((await service.observe(f.bound.profileHash, f.bound.operationId)).state, "unknown_finality");
      await assert.rejects(() => service.execute(f.bound.profileHash, f.bound.operationId), { code: "APN_OPERATION_BLOCKED" });
      assert.equal(sends, 1);
    }
  }
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

const USER_OPERATION_EVENT = toEventSelector("UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)");
const TRANSFER_EVENT = toEventSelector("Transfer(address indexed from, address indexed to, uint256 value)");
const TX = `0x${"cc".repeat(32)}` as const;
function observedReceipt(hash: `0x${string}`, success: boolean, sender: `0x${string}`): UsdtChainReceipt {
  const logs = [{ address: USDT_GASLESS.entryPoint,
    topics: [USER_OPERATION_EVENT, hash, padHex(sender, { size: 32 }), padHex(USDT_GASLESS.paymaster, { size: 32 })],
    data: encodeAbiParameters([{ type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }],
      [7n, success, 10n, 20n]) }];
  if (success) for (const [to, amount] of [[RECIPIENT, 500_000n], [USDT_GASLESS.treasury, 100_000n]] as const) {
    logs.push({ address: USDT_GASLESS.token, topics: [TRANSFER_EVENT, padHex(sender, { size: 32 }), padHex(to, { size: 32 })],
      data: padHex(numberToHex(amount), { size: 32 }) });
  }
  return { transactionHash: TX, blockNumber: 26_002_951n, status: "success", logs };
}

test("recovery finalizes an observed pending UserOperation once and replays without RPC", async t => {
  const f = await setup(); t.after(f.temporary.cleanup);
  const journal = new UsdtExecutionJournal(f.temporary.root), signed = await f.signer.sign(f.bound, f.expected);
  await journal.reserve(f.bound, usdtExecutionIntent(f.bound), f.port);
  await journal.markSubmitting(f.bound, f.port, signed.userOperationHash);
  await journal.markSubmitted(f.bound, signed.userOperationHash, NOW);
  let lookups = 0;
  const port: UsdtRecoveryPort = { userOperationReceipt: async () => { lookups++; return { userOpHash: signed.userOperationHash,
    sender: OWNER, entryPoint: USDT_GASLESS.entryPoint, paymaster: USDT_GASLESS.paymaster,
    success: true, transactionHash: TX }; }, canonicalFinalizedReceipt: async () => observedReceipt(signed.userOperationHash, true, OWNER) };
  const recovery = new UsdtRecoveryService(journal, port, () => NOW);
  const result = await recovery.observe(f.bound);
  assert.equal(result.state, "finalized");
  assert.equal(result.settlement?.recipientCreditAtomic, "500000");
  assert.equal(result.settlement?.feeAtomic, "100000");
  assert.equal((await new AssetUsageLedger(f.temporary.root).load({ account: OWNER, chain: USDT_GASLESS.chain,
    asset: { kind: "token", identifier: USDT_GASLESS.token } }, result.reservationId))?.state, "finalized");
  assert.deepEqual(await recovery.observe(f.bound), result);
  assert.equal(lookups, 1);
});

test("recovery releases usage only for canonical failed UserOperationEvent", async t => {
  const f = await setup(); t.after(f.temporary.cleanup);
  const journal = new UsdtExecutionJournal(f.temporary.root), signed = await f.signer.sign(f.bound, f.expected);
  await journal.reserve(f.bound, usdtExecutionIntent(f.bound), f.port);
  await journal.markSubmitting(f.bound, f.port, signed.userOperationHash);
  const recovery = new UsdtRecoveryService(journal, { userOperationReceipt: async () => ({ userOpHash: signed.userOperationHash,
    sender: OWNER, entryPoint: USDT_GASLESS.entryPoint, paymaster: USDT_GASLESS.paymaster,
    success: false, transactionHash: TX }), canonicalFinalizedReceipt: async () => observedReceipt(signed.userOperationHash, false, OWNER) }, () => NOW);
  const result = await recovery.observe(f.bound);
  assert.equal(result.state, "failed_confirmed_revert");
  assert.equal(result.settlement, null);
  assert.equal((await new AssetUsageLedger(f.temporary.root).load({ account: OWNER, chain: USDT_GASLESS.chain,
    asset: { kind: "token", identifier: USDT_GASLESS.token } }, result.reservationId))?.state, "failed_confirmed_revert");
  assert.deepEqual(await recovery.observe(f.bound), result);
});

test("pre-send crash, pending, malformed, mismatched and unavailable observations retain unknown finality", async t => {
  for (const caseName of ["missing", "wrong_hash", "wrong_chain_event", "malformed", "provider_failure"] as const) {
    const f = await setup(); t.after(f.temporary.cleanup);
    const journal = new UsdtExecutionJournal(f.temporary.root), signed = await f.signer.sign(f.bound, f.expected);
    await journal.reserve(f.bound, usdtExecutionIntent(f.bound), f.port);
    await journal.markSubmitting(f.bound, f.port, signed.userOperationHash);
    const port: UsdtRecoveryPort = { userOperationReceipt: async () => {
      if (caseName === "provider_failure") throw new Error("provider unavailable");
      if (caseName === "missing") return null;
      return { userOpHash: caseName === "wrong_hash" ? `0x${"aa".repeat(32)}` : signed.userOperationHash,
        sender: OWNER, entryPoint: USDT_GASLESS.entryPoint, paymaster: USDT_GASLESS.paymaster,
        success: true, transactionHash: TX };
    }, canonicalFinalizedReceipt: async () => caseName === "malformed" ? null :
      observedReceipt(caseName === "wrong_chain_event" ? `0x${"bb".repeat(32)}` : signed.userOperationHash, true, OWNER) };
    const recovery = new UsdtRecoveryService(journal, port, () => NOW);
    assert.equal((await recovery.observe(f.bound)).state, "unknown_finality", caseName);
    assert.equal((await recovery.observe(f.bound)).state, "unknown_finality", caseName);
    assert.equal((await new AssetUsageLedger(f.temporary.root).load({ account: OWNER, chain: USDT_GASLESS.chain,
      asset: { kind: "token", identifier: USDT_GASLESS.token } }, (await journal.load(f.bound.operationId))!.reservationId))?.state,
    "unknown_finality", caseName);
  }
});
