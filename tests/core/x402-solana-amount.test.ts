import assert from "node:assert/strict";
import test from "node:test";
import { SOLANA_USDC } from "../../src/chain-policy.js";
import type { X402SolanaRecord } from "../../src/x402-solana/model.js";
import { approveX402SolanaAbandon } from "../../src/x402-solana/runtime.js";
import { publicX402Solana } from "../../src/x402-solana/view.js";

// X402-SOLANA-DECIMAL-DIRECTION-053-001: a 1000-atom USDC payment showed amount_decimal "1000000000" (the decimal→atomic
// parser applied to atoms). The status and the abandon screen must render atoms → display units.
function record(amountAtomic: string): X402SolanaRecord {
  const terms = {
    network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", chain: "solana", payer: "payer", mint: SOLANA_USDC, symbol: "USDC", decimals: 6,
    payee: "payee", destinationTokenAccount: "ata", feePayer: "facilitator", amountAtomic, maxAmountAtomic: "20000",
    computeUnitLimit: 20000, computeUnitPriceMicroLamports: 1, memo: "m", memoSource: "nonce", origin: "https://seller.example",
    urlHash: "u", challengeHash: "c", offerIndex: 0, offerHash: "o", expiresAt: "2026-10-20T00:00:00.000Z",
    admission: { policyDigest: "p", policyRevision: 1, maximumPerTransferAtomic: "50000", dailyLimitAtomic: "100000" },
  };
  return { kind: "x402_solana", operationId: "op", profile: "default", state: "exposed", terminal: false, fingerprint: "f", terms,
    response: null, lifetime: null, lease: null, signed: null, exposure: null, settlement: null, unlanded: null,
    createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z" } as unknown as X402SolanaRecord;
}

for (const [atomic, display] of [["1", "0.000001"], ["1000", "0.001"], ["1000000", "1"], ["1234567", "1.234567"]] as const) {
  test(`${atomic} USDC atoms render as ${display} in status and on the abandon screen`, async () => {
    const status = publicX402Solana(record(atomic)) as { amount_atomic: string; amount_decimal: string };
    assert.equal(status.amount_atomic, atomic);
    assert.equal(status.amount_decimal, display);
    let shown: { amountAtomic: string; amountDecimal: string } | undefined;
    await approveX402SolanaAbandon({ approve: async (screen: { amountAtomic: string; amountDecimal: string }) => { shown = screen; } } as never, record(atomic));
    assert.equal(shown?.amountAtomic, atomic);
    assert.equal(shown?.amountDecimal, display);
  });
}
