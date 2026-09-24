import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodeRawBuildResponse } from "../../src/swap/jupiter-solana/codec.js";

// Public, sanitized response from one keyless GET. This is a historical route sample,
// not a reusable quote, a deployed-program attestation, or signing authority.
const fixture = JSON.parse(readFileSync(new URL("../../../tests/core/jupiter-fixtures/official-sol-usdc-quantum-build-20260924.json", import.meta.url), "utf8")) as {
  fixtureMetadata: { httpStatus: number; request: { taker: string; inputMint: string; outputMint: string; amount: string }; retrievedAtUtc: string; source: string };
  response: Record<string, any>;
};
const EXPECTED_HASH = "b361ba9c7bbcb709a4f3b7c4401b8ed86c215704431fac3e2852894fe8506645";
const TAKER = "GtZc9wfM98Peee7dJrL1dYE54sWU8zA8gYeo9VUfR9ki";
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const LOOKUP = "4X2SPN7fw3WZZ6CXkaeXDsnVEomJ3AWe1PCQW2kpFc44";

/** Exact historical capture assertion for tests only; never call from a signer. */
function assertCapturedRoute(response: unknown): void {
  const decoded = decodeRawBuildResponse(response);
  assert.equal(decoded.responseHash, EXPECTED_HASH, "the captured route instruction, accounts, lookup table, or quote changed");
}

test("official keyless SOL to USDC Quantum raw build decodes and stays non-signable", () => {
  assert.equal(fixture.fixtureMetadata.httpStatus, 200);
  assert.equal(fixture.fixtureMetadata.source, "https://api.jup.ag/swap/v2/build");
  assert.equal(fixture.fixtureMetadata.retrievedAtUtc, "2026-09-24T23:00:22.065152+00:00");
  assert.deepEqual(fixture.fixtureMetadata.request, { amount: "1000000", inputMint: SOL, outputMint: USDC, taker: TAKER });
  assertCapturedRoute(fixture.response);
  const decoded = decodeRawBuildResponse(fixture.response);
  assert.equal(decoded.swapMode, "ExactIn");
  assert.equal(decoded.slippageBps, 50);
  assert.equal(decoded.outAmount, "116603");
  assert.equal(decoded.routePlan.length, 1);
  assert.equal(decoded.routePlan[0]?.percent, 100);
  assert.equal(decoded.routePlan[0]?.swapInfo.label, "Quantum");
  assert.equal(decoded.computeBudgetInstructions.length + decoded.setupInstructions.length +
    decoded.otherInstructions.length + 1 + Number(decoded.cleanupInstruction !== null) + Number(decoded.tipInstruction !== null), 7);
  assert.equal(decoded.swapInstruction.programId, "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4");
  assert.equal(decoded.swapInstruction.accounts.length, 21);
  assert.equal(Object.keys(decoded.addressesByLookupTableAddress ?? {}).length, 1);
  assert.ok(decoded.addressesByLookupTableAddress?.[LOOKUP]);
});

test("historical route assertion rejects instruction, account, lookup, and quote mutations", () => {
  const cases: Record<string, (response: Record<string, any>) => void> = {
    "swap program": (r) => { r.swapInstruction.programId = SOL; },
    "setup program": (r) => { r.setupInstructions[0].programId = SOL; },
    "account signer": (r) => { r.swapInstruction.accounts[0].isSigner = false; },
    "account writable": (r) => { r.swapInstruction.accounts[1].isWritable = false; },
    "account identity": (r) => { r.swapInstruction.accounts[1].pubkey = SOL; },
    "route instruction data": (r) => { r.swapInstruction.data = "AA=="; },
    "lookup table address": (r) => { r.addressesByLookupTableAddress[SOL] = r.addressesByLookupTableAddress[LOOKUP]; delete r.addressesByLookupTableAddress[LOOKUP]; },
    "lookup index order": (r) => { [r.addressesByLookupTableAddress[LOOKUP][0], r.addressesByLookupTableAddress[LOOKUP][1]] =
      [r.addressesByLookupTableAddress[LOOKUP][1], r.addressesByLookupTableAddress[LOOKUP][0]]; },
    "taker account": (r) => { r.swapInstruction.accounts[0].pubkey = SOL; },
    "input mint": (r) => { r.inputMint = USDC; },
    "output mint": (r) => { r.outputMint = SOL; },
    "input amount": (r) => { r.inAmount = "1000001"; },
    "quoted AMM": (r) => { r.routePlan[0].swapInfo.ammKey = SOL; },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const response = structuredClone(fixture.response);
    mutate(response);
    assert.throws(() => assertCapturedRoute(response), Error, name);
  }
});
