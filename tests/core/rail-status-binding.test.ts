import assert from "node:assert/strict";
import test from "node:test";
import { getBase58Decoder } from "@solana/kit";
import { normalizeLifiStatus } from "../../src/lifi/provider.js";
import { isEvmTransactionHash, isSolanaTransactionSignature, railStatusFamily } from "../../src/rail-status-binding.js";

const AT = "2026-09-16T10:00:00.000Z";
const EVM_HASH = `0x${"ab".repeat(32)}`;
const SOLANA_SIGNATURE = getBase58Decoder().decode(new Uint8Array(64).fill(7));
/** A 32-byte base58 address is not a 64-byte signature, so it is not a transaction identity. */
const SOLANA_ADDRESS = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

const observation = (txHash: unknown) => normalizeLifiStatus({
  status: 200, body: JSON.stringify({ status: "DONE", substatus: "COMPLETED", receiving: { txHash } }),
}, AT);

test("a base58 Solana status binding is carried as itself and no longer discards the whole observation", () => {
  const solana = observation(SOLANA_SIGNATURE);
  assert.equal(solana.destinationTransactionHash, SOLANA_SIGNATURE);
  // At 0.5.18 the hex reader threw here, the catch swallowed it and the status collapsed to unknown.
  assert.equal(solana.status, "completed_observed");
  assert.equal(railStatusFamily(solana.destinationTransactionHash), "solana");
  assert.equal(isEvmTransactionHash(solana.destinationTransactionHash), false);
});

test("an EVM status binding must still be a 32-byte hash, lowercased exactly as before", () => {
  assert.equal(observation(EVM_HASH).destinationTransactionHash, EVM_HASH);
  assert.equal(observation(EVM_HASH.toUpperCase().replace("0X", "0x")).destinationTransactionHash, EVM_HASH);
  assert.equal(observation(EVM_HASH).status, "completed_observed");
  assert.equal(railStatusFamily(EVM_HASH), "evm");
});

test("no other string is admitted as a transaction identity", () => {
  for (const value of [
    "not-a-signature", "", "0x", `0x${"ab".repeat(31)}`, `0x${"ab".repeat(33)}`, `0x${"zz".repeat(32)}`,
    SOLANA_ADDRESS, `${SOLANA_SIGNATURE}1`, SOLANA_SIGNATURE.slice(0, 63), `0O${SOLANA_SIGNATURE.slice(2)}`,
    1, null, {}, [SOLANA_SIGNATURE],
  ]) {
    assert.equal(railStatusFamily(value), null, `admitted ${JSON.stringify(value)}`);
    const refused = observation(value);
    assert.equal(refused.destinationTransactionHash, null);
    assert.equal(refused.status, "unknown");
  }
});

test("an absent receiving hash still leaves the classified status and a null binding", () => {
  const without = normalizeLifiStatus({ status: 200, body: JSON.stringify({ status: "PENDING" }) }, AT);
  assert.equal(without.status, "pending"); assert.equal(without.destinationTransactionHash, null);
  const empty = normalizeLifiStatus({ status: 200, body: JSON.stringify({ status: "DONE", substatus: "COMPLETED", receiving: null }) }, AT);
  assert.equal(empty.status, "completed_observed"); assert.equal(empty.destinationTransactionHash, null);
});

test("the Solana predicate accepts only canonical base58 of exactly 64 bytes", () => {
  assert.equal(isSolanaTransactionSignature(SOLANA_SIGNATURE), true);
  assert.equal(isSolanaTransactionSignature(getBase58Decoder().decode(new Uint8Array(63).fill(7))), false);
  assert.equal(isSolanaTransactionSignature(getBase58Decoder().decode(new Uint8Array(65).fill(7))), false);
  assert.equal(isSolanaTransactionSignature(SOLANA_ADDRESS), false);
});
