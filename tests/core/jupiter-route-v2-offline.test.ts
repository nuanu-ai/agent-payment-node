import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodeRawBuildResponse } from "../../src/swap/jupiter-solana/codec.js";
import { checkQuantumBuildConsistencyOffline, decodeQuantumRouteV2Offline, type RouteV2FixedAccounts } from "../../src/swap/jupiter-solana/route-v2-offline.js";

const fixture = JSON.parse(readFileSync(new URL("../../../tests/core/jupiter-fixtures/official-sol-usdc-quantum-build-20260924.json", import.meta.url), "utf8")) as {
  response: Record<string, any>;
};
const JUP6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";
const TAKER = "GtZc9wfM98Peee7dJrL1dYE54sWU8zA8gYeo9VUfR9ki";
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const expected: RouteV2FixedAccounts = {
  userTransferAuthority: TAKER,
  userSourceTokenAccount: "9gSK9SbSKGyUstAvLNmFCPo6Fn4Cw5p2QSP7hGPtRbqG",
  userDestinationTokenAccount: "2TCBNWRmA9d1APAiTS8jtnAr1SjGembE7KGiNTv5jGjX",
  sourceMint: SOL,
  destinationMint: USDC,
  sourceTokenProgram: TOKEN,
  destinationTokenProgram: TOKEN,
  destinationTokenAccount: null,
  eventAuthority: "D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf",
};

function instruction(): Record<string, any> { return structuredClone(fixture.response.swapInstruction); }
function decode(value: unknown, accounts = expected) {
  return decodeQuantumRouteV2Offline(value as ReturnType<typeof decodeRawBuildResponse>["swapInstruction"], accounts);
}
function changeData(mutate: (data: Buffer) => void): Record<string, any> {
  const value = instruction(); const data = Buffer.from(value.data, "base64"); mutate(data); value.data = data.toString("base64"); return value;
}

test("historical raw Quantum route_v2 has typed arguments and ten exact fixed accounts, but remains non-signable", () => {
  const raw = decodeRawBuildResponse(fixture.response);
  const route = decode(raw.swapInstruction, expected);
  assert.deepEqual(route, { signable: false, inAmount: "1000000", quotedOutAmount: "116603", slippageBps: 50,
    platformFeeBps: 0, positiveSlippageBps: 0,
    routePlan: [{ swap: "Quantum", side: 0, bps: 10000, inputIndex: 0, outputIndex: 1 }], remainingAccountCount: 11 });
  assert.equal(raw.swapInstruction.accounts[7]?.pubkey, JUP6); // Optional account's None sentinel.
});

test("route_v2 rejects every fixed-account identity and privilege mutation", () => {
  for (let index = 0; index < 10; index++) {
    for (const field of ["pubkey", "isWritable", "isSigner"] as const) {
      const value = instruction(); const account = value.accounts[index];
      account[field] = field === "pubkey" ? account.pubkey === SOL ? USDC : SOL : !account[field];
      assert.throws(() => decode(value), /fixed account/, `${field} at index ${index}`);
    }
  }
  const present = instruction(); present.accounts[7] = { pubkey: USDC, isWritable: true, isSigner: false };
  assert.equal(decode(present, { ...expected, destinationTokenAccount: USDC }).signable, false);
});

test("route_v2 refuses changed framing, variant, side and impossible bps", () => {
  const cases = [
    changeData((data) => { data[0] = data[0]! ^ 1; }),
    changeData((data) => { data.writeUInt32LE(2, 30); }),
    changeData((data) => { data[34] = 124; }),
    changeData((data) => { data[35] = 2; }),
    changeData((data) => { data.writeUInt16LE(10001, 36); }),
    changeData((data) => { data.writeUInt16LE(0, 36); }),
  ];
  const truncated = instruction(); truncated.data = Buffer.from(truncated.data, "base64").subarray(0, 39).toString("base64"); cases.push(truncated);
  const trailing = instruction(); trailing.data = Buffer.concat([Buffer.from(trailing.data, "base64"), Buffer.from([0])]).toString("base64"); cases.push(trailing);
  const program = instruction(); program.programId = SOL; cases.push(program);
  for (const value of cases) assert.throws(() => decode(value));
});

test("captured single-step Quantum build reconciles quote, route and instruction without signing", () => {
  const result = checkQuantumBuildConsistencyOffline(decodeRawBuildResponse(fixture.response), expected);
  assert.equal(result.signable, false);
  assert.equal(result.inAmount, "1000000");
  assert.equal(result.quotedOutAmount, "116603");
});

test("Quantum build rejects self-consistent quote mutations and instruction mismatches", () => {
  const cases: Record<string, (response: Record<string, any>) => void> = {
    "build input": (r) => { r.inAmount = "1000001"; },
    "build output": (r) => { r.outAmount = "116604"; },
    "build slippage": (r) => { r.slippageBps = 51; },
    "build input mint": (r) => { r.inputMint = USDC; },
    "build output mint": (r) => { r.outputMint = SOL; },
    "route input": (r) => { r.routePlan[0].swapInfo.inAmount = "1000001"; },
    "route output": (r) => { r.routePlan[0].swapInfo.outAmount = "116604"; },
    "route input mint": (r) => { r.routePlan[0].swapInfo.inputMint = USDC; },
    "route output mint": (r) => { r.routePlan[0].swapInfo.outputMint = SOL; },
    "route label": (r) => { r.routePlan[0].swapInfo.label = "Other"; },
    "route percent": (r) => { r.routePlan[0].percent = 99; },
    "route bps": (r) => { r.routePlan[0].bps = 9999; },
    "instruction input": (r) => { const d = Buffer.from(r.swapInstruction.data, "base64"); d.writeBigUInt64LE(1000001n, 8); r.swapInstruction.data = d.toString("base64"); },
    "instruction output": (r) => { const d = Buffer.from(r.swapInstruction.data, "base64"); d.writeBigUInt64LE(116604n, 16); r.swapInstruction.data = d.toString("base64"); },
    "instruction slippage": (r) => { const d = Buffer.from(r.swapInstruction.data, "base64"); d.writeUInt16LE(51, 24); r.swapInstruction.data = d.toString("base64"); },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const response = structuredClone(fixture.response); mutate(response);
    assert.throws(() => checkQuantumBuildConsistencyOffline(decodeRawBuildResponse(response), expected), Error, name);
  }
  assert.throws(() => checkQuantumBuildConsistencyOffline(decodeRawBuildResponse(fixture.response), { ...expected, userTransferAuthority: SOL }), /fixed account/);
});

test("Quantum build rejects unsupported route layouts and threshold above quote", () => {
  const cases: Record<string, (response: Record<string, any>) => void> = {
    "ExactOut": (r) => { r.swapMode = "ExactOut"; },
    "two quoted steps": (r) => { r.routePlan.push(structuredClone(r.routePlan[0])); },
    "instruction side": (r) => { const d = Buffer.from(r.swapInstruction.data, "base64"); d[35] = 1; r.swapInstruction.data = d.toString("base64"); },
    "instruction bps": (r) => { const d = Buffer.from(r.swapInstruction.data, "base64"); d.writeUInt16LE(9999, 36); r.swapInstruction.data = d.toString("base64"); },
    "instruction indices": (r) => { const d = Buffer.from(r.swapInstruction.data, "base64"); d[38] = 1; d[39] = 0; r.swapInstruction.data = d.toString("base64"); },
    "threshold above quote": (r) => { r.otherAmountThreshold = "116604"; },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const response = structuredClone(fixture.response); mutate(response);
    assert.throws(() => checkQuantumBuildConsistencyOffline(decodeRawBuildResponse(response), expected), Error, name);
  }
});
