import assert from "node:assert/strict";
import test from "node:test";
import { concat, decodeFunctionData, encodeFunctionData, keccak256, padHex, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { USDT_GASLESS } from "../../src/gasless-usdt/model.js";
import { usdtSponsorHash, usdtSponsorPackedOperation, recoverUsdtSponsor } from "../../src/gasless-usdt/sponsor-hash.js";
import { attestUsdtSponsor, assertUsdtSponsorWindow, type UsdtSponsorSnapshot } from "../../src/gasless-usdt/sponsor-auth.js";
import { usdtUserOperationHash, type UsdtUserOperation } from "../../src/gasless-usdt/userop.js";
import type { GaslessTransport } from "../../src/gasless/https.js";
const key = privateKeyToAccount(`0x${"11".repeat(32)}`);
const word = (value: bigint, size = 32): Hex => padHex(`0x${value.toString(16)}`, { size });
const NOW = 1_800_000_000n;
const clock = { now: () => new Date(Number(NOW) * 1000) };
const payload = (signature: Hex, mode = "02", until = NOW + 300n, after = NOW): Hex => concat([
  `0x${mode}00`, word(until, 6), word(after, 6), USDT_GASLESS.token, word(19500n, 16), word(2989469350n),
  word(80000n, 16), USDT_GASLESS.treasury, signature,
]);
const draft = (cold = true): UsdtUserOperation => ({ sender: key.address, nonce: "0x7",
  ...(cold ? { factory: "0x7702" as const, factoryData: "0x" as const } : {}),
  callData: "0x123456", callGasLimit: "0x3d090", verificationGasLimit: "0x249f0", preVerificationGas: "0xc350",
  maxFeePerGas: "0x12a0fcf9", maxPriorityFeePerGas: "0xcdc27ec", paymaster: USDT_GASLESS.paymaster,
  paymasterVerificationGasLimit: "0x30d40", paymasterPostOpGasLimit: "0xc350",
  paymasterData: payload(`0x${"00".repeat(64)}1b`), signature: "0x" });
async function signed(op = draft()): Promise<UsdtUserOperation> {
  const signature = await key.signMessage({ message: { raw: usdtSponsorHash(op) } });
  return { ...op, paymasterData: `${op.paymasterData.slice(0, -130)}${signature.slice(2)}` as Hex };
}
const snapshot: UsdtSponsorSnapshot = { chainId: 1n, blockNumber: 100n, blockHash: `0x${"ab".repeat(32)}`,
  pins: { token: USDT_GASLESS.tokenCodeHash, entryPoint: USDT_GASLESS.entryPointCodeHash,
    delegate: USDT_GASLESS.delegateCodeHash, paymaster: USDT_GASLESS.paymasterCodeHash, paymasterEntryPoint: USDT_GASLESS.entryPoint } };
const ABI = parseAbi(["function signers(address) view returns (bool)",
  "function getHash(uint8 mode,(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)"]);
function peer(op: UsdtUserOperation, seen: unknown[][], member = 1n, hash = usdtSponsorHash(op), onRead = () => {}): GaslessTransport {
  return { async request(_endpoint, method, body) {
    assert.equal(method, "POST"); const batch = JSON.parse(body!) as { id: string; method: string; params: unknown[] }[];
    seen.push(batch); assert.equal(batch.length, 2);
    for (const call of batch) {
      assert.equal(call.method, "eth_call"); assert.deepEqual(call.params[1], { blockHash: snapshot.blockHash, requireCanonical: true });
      assert.equal((call.params[0] as { to: string }).to, USDT_GASLESS.paymaster);
    }
    const decoded = decodeFunctionData({ abi: ABI, data: (batch[1]!.params[0] as { data: Hex }).data });
    assert.equal(decoded.functionName, "getHash"); assert.equal(decoded.args![0], 1);
    assert.equal((batch[1]!.params[0] as { data: Hex }).data, encodeFunctionData({ abi: ABI, functionName: "getHash", args: [1, usdtSponsorPackedOperation(op)] }));
    onRead();
    return { status: 200, body: JSON.stringify(batch.map((call, i) => ({ jsonrpc: "2.0", id: call.id,
      result: i === 0 ? word(member) : hash })).reverse()) };
  } };
}
const attest = (op: UsdtUserOperation, transport: GaslessTransport, extra = {}) => attestUsdtSponsor({ op, transport,
  rpcUrl: "https://rpc.test/", snapshot, expectedBlockHash: snapshot.blockHash, clock, ...extra });

test("deployed V7 hash matches independent static-word encoding; raw marker and signature exclusion", async () => {
  const op = draft(), p = usdtSponsorPackedOperation(op);
  const independent = keccak256(concat([padHex(p.sender, { size: 32 }), word(7n), p.accountGasLimits, word(50000n),
    p.gasFees, keccak256("0x7702"), keccak256("0x123456"), keccak256(`0x${p.paymasterAndData.slice(2, 342)}`)]));
  const expected = keccak256(concat([independent, word(1n)]));
  assert.equal(expected, "0xaa1d3f5ae57a78f715b4239b52fbb9d3269bbe83bed21ab301f491e923e5db5b");
  assert.equal(usdtSponsorHash(op), expected);
  assert.equal(p.initCode, "0x7702"); assert.equal(p.paymasterAndData.length, 472);
  const authorized = await signed(op); assert.equal(usdtSponsorHash(authorized), expected);
  assert.equal((await recoverUsdtSponsor(authorized)).signer, key.address);
  assert.equal(usdtSponsorHash({ ...authorized, signature: "0xdeadbeef" }), expected);
  assert.notEqual(usdtUserOperationHash(authorized), expected);
});

test("every frozen field and actual packed mode/rate affect sponsor hash", () => {
  const op = draft(), original = usdtSponsorHash(op);
  for (const patch of [{ nonce: "0x8" }, { callData: "0x123457" }, { callGasLimit: "0x3d091" },
    { verificationGasLimit: "0x249f1" }, { preVerificationGas: "0xc351" }, { maxFeePerGas: "0x12a0fcfa" },
    { maxPriorityFeePerGas: "0xcdc27ed" }, { paymasterPostOpGasLimit: "0xc351" },
    { paymasterData: `0x03${op.paymasterData.slice(4)}` },
    { paymasterData: `${op.paymasterData.slice(0, 164)}a7${op.paymasterData.slice(166)}` }]) {
    assert.notEqual(usdtSponsorHash({ ...op, ...patch } as UsdtUserOperation), original);
  }
  assert.notEqual(usdtSponsorHash(draft(false)), original);
  assert.throws(() => usdtSponsorHash({ ...op, callGasLimit: `0x1${"0".repeat(32)}` }), /sponsor_uint/u);
  assert.throws(() => usdtSponsorHash({ ...op, nonce: "0x07" }), /sponsor_uint/u);
  assert.throws(() => usdtSponsorHash({ ...op, paymasterData: `0x0201${op.paymasterData.slice(6)}` }), /paymaster_flags/u);
  assert.throws(() => usdtSponsorHash({ ...op, paymaster: key.address }), /sponsor_identity/u);
});

test("strict recovery rejects wrong length, high S, zero S and non-contract v", async () => {
  const op = await signed();
  for (const signature of [`0x${"11".repeat(64)}`, `0x${"11".repeat(32)}${"ff".repeat(32)}1b`,
    `0x${"11".repeat(32)}${"00".repeat(32)}1b`, `0x${"11".repeat(64)}00`, `0x${"11".repeat(64)}1d`]) {
    await assert.rejects(recoverUsdtSponsor({ ...op, paymasterData: `${op.paymasterData.slice(0, -130)}${signature.slice(2)}` as Hex }),
      /signature|paymaster_data_shape/u);
  }
});

test("cold and warm auth use one exact canonical batch with local signer and serializable evidence", async () => {
  for (const cold of [true, false]) {
    const op = await signed(draft(cold)), seen: unknown[][] = [];
    const evidence = await attest(op, peer(op, seen));
    assert.equal(seen.length, 1); assert.equal(evidence.signer, key.address); assert.equal(evidence.membership, true);
    assert.equal(evidence.parityHash, usdtSponsorHash(op)); assert.equal(evidence.capturedAt, clock.now().toISOString());
    assert.doesNotThrow(() => JSON.stringify(evidence));
  }
});

test("auth refuses nonmembers, parity drift and bad chain/pins/block before exposing any signer custody", async () => {
  const op = await signed(), seen: unknown[][] = [];
  await assert.rejects(attest(op, peer(op, seen, 0n)), /sponsor_not_member/u);
  await assert.rejects(attest(op, peer(op, seen, 1n, `0x${"cd".repeat(32)}`)), /hash_parity/u);
  for (const changed of [{ ...snapshot, chainId: 2n }, { ...snapshot, blockNumber: 0n },
    { ...snapshot, blockHash: `0x${"cd".repeat(32)}` }, { ...snapshot, pins: { ...snapshot.pins, paymaster: `0x${"00".repeat(32)}` } }]) {
    const count = seen.length;
    await assert.rejects(attest(op, peer(op, seen), { snapshot: changed }), /sponsor_snapshot/u);
    assert.equal(seen.length, count);
  }
});

test("payload validity uses live post-await clock and exact inclusive bounds", async () => {
  const op = draft();
  for (const until of [NOW + 60n, NOW + 3600n]) assert.doesNotThrow(() => assertUsdtSponsorWindow({ ...op,
    paymasterData: payload(`0x${"11".repeat(64)}1b`, "02", until) }, clock));
  for (const [until, after] of [[NOW + 59n, NOW], [NOW + 3601n, NOW], [NOW + 300n, NOW + 1n]]) {
    assert.throws(() => assertUsdtSponsorWindow({ ...op, paymasterData: payload(`0x${"11".repeat(64)}1b`, "02", until, after) }, clock), /validity/u);
  }
  const authorized = await signed(), seen: unknown[][] = []; let ms = Number(NOW) * 1000;
  await assert.rejects(attest(authorized, peer(authorized, seen, 1n, usdtSponsorHash(authorized), () => { ms += 241000; }),
    { clock: { now: () => new Date(ms) } }), /validity/u);
  assert.equal(seen.length, 1);
});


test("identity, malformed membership, missing proof and canonical-block RPC refusal fail closed", async () => {
  const op = await signed(), seen: unknown[][] = [];
  for (const field of ["token", "entryPoint", "delegate", "paymaster"] as const) {
    await assert.rejects(attest(op, peer(op, seen), { snapshot: { ...snapshot,
      pins: { ...snapshot.pins, [field]: `0x${"00".repeat(32)}` } } }), /sponsor_snapshot/u);
  }
  await assert.rejects(attest(op, peer(op, seen), { snapshot: { ...snapshot, pins: undefined } }), /sponsor_snapshot/u);
  assert.equal(seen.length, 0);
  for (const replace of [
    `${op.paymasterData.slice(0, 30)}${key.address.slice(2)}${op.paymasterData.slice(70)}`,
    `${op.paymasterData.slice(0, 198)}${key.address.slice(2)}${op.paymasterData.slice(238)}`,
  ]) assert.throws(() => usdtSponsorHash({ ...op, paymasterData: replace as Hex }), /payload_identity/u);
  await assert.rejects(attest(op, peer(op, seen, 2n)), /sponsor_not_member/u);
  const malformed = { ...op, paymasterData: `${op.paymasterData.slice(0, -2)}00` as Hex };
  const count = seen.length;
  await assert.rejects(attest(malformed, peer(op, seen)), /sponsor_signature/u);
  assert.equal(seen.length, count);
  let attempts = 0;
  const refusing: GaslessTransport = { request: async () => { attempts++; return { status: 200,
    body: JSON.stringify([{ jsonrpc: "2.0", id: "1", error: { code: -32602, message: "canonical hash unsupported" } },
      { jsonrpc: "2.0", id: "2", result: usdtSponsorHash(op) }]) }; } };
  await assert.rejects(attest(op, refusing)); assert.equal(attempts, 1);
});
