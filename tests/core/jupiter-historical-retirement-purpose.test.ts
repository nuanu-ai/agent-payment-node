import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { historicalJupiterRetirementConsentLines } from "../../src/swap/jupiter-solana/historical-retirement-purpose.js";
import { HISTORICAL_JUPITER_IDS, HISTORICAL_JUPITER_PAYER } from "../../src/swap/jupiter-solana/historical-pins.js";

test("new retirement consent states full conservative accounting and preserves unknown chain outcome", () => {
  for (const id of HISTORICAL_JUPITER_IDS) {
    const lines = historicalJupiterRetirementConsentLines(id);
    const text = lines.join("\n");
    assert(Object.isFrozen(lines)); assert(text.includes(id)); assert(text.includes(HISTORICAL_JUPITER_PAYER));
    assert(text.includes("6000000 total lamports")); assert(text.includes("5000000 additional lamports"));
    assert(text.includes("existing 1000000-lamport hold")); assert(text.includes("actual expense remain unknown"));
    assert(text.includes("may have been submitted")); assert(text.includes("No chain payment, new signing, resubmission"));
    assert(text.includes("active owner policy"));
    assert(text.includes("full 6000000-lamport per-operation amount"));
  }
});
test("retirement purpose refuses unknown targets and leaves old authentication consent intact", async () => {
  assert.throws(() => historicalJupiterRetirementConsentLines("f".repeat(64)));
  const original = await readFile(new URL("../../src/swap/jupiter-solana/historical-projection-reader.js", import.meta.url), "utf8");
  assert(original.includes("No ledger retirement, charge, expiry verdict or past absence is authorized."));
});
