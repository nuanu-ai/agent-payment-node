import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodeRawBuildResponse } from "../../src/swap/jupiter-solana/codec.js";
import { decodeQuantumRouteV2Offline, type RouteV2FixedAccounts } from "../../src/swap/jupiter-solana/route-v2-offline.js";

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
