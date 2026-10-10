import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "../fixtures/jupiter-v1/material.js";
import { jupiterV1MaterialDigest, validateJupiterV1Material, type JupiterV1QuoteRpcLifetime } from "../../src/swap/jupiter-solana/v1-material.js";

// Full production material validation, with generated TEST material only.
// This grants no historical owner capability and does not call custody, RPC, or a writer.
test("full material validation binds six-field lifetime provenance before canonical projection", () => {
  const original = fixture();
  const lifetime: JupiterV1QuoteRpcLifetime = {
    source: "configured_mainnet_rpc_before_quote_freeze", rpcOriginHash: "7".repeat(64),
    contextSlot: original.accountSlot, minimumContextSlot: original.accountSlot,
    blockhash: original.lifetime.blockhash, lastValidBlockHeight: original.lifetime.lastValidBlockHeight,
  };
  const { materialDigest: _oldDigest, ...body } = { ...original, quoteRpcLifetime: lifetime };
  const material = { ...body, materialDigest: jupiterV1MaterialDigest(body) };
  assert.equal(validateJupiterV1Material(material), material);
  for (const altered of [
    { ...lifetime, source: "provider_raw_build" },
    { ...lifetime, rpcOriginHash: "8".repeat(64) },
    { ...lifetime, minimumContextSlot: (BigInt(lifetime.minimumContextSlot) + 1n).toString() },
    { ...lifetime, contextSlot: (BigInt(lifetime.contextSlot) + 1n).toString() },
    { ...lifetime, blockhash: "1".repeat(32) },
    { ...lifetime, lastValidBlockHeight: (BigInt(lifetime.lastValidBlockHeight) + 1n).toString() },
  ]) {
    assert.throws(() => validateJupiterV1Material({ ...material, quoteRpcLifetime: altered }), { code: "APN_STATE_CORRUPT" });
  }
  assert.throws(() => validateJupiterV1Material({ ...material, transactionBase64: "altered TEST material" }), { code: "APN_STATE_CORRUPT" });
  assert.deepEqual(material.quoteRpcLifetime, lifetime);
});
