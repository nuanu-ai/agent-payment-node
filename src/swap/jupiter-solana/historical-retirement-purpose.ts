import { HISTORICAL_JUPITER_IDS, HISTORICAL_JUPITER_PAYER } from "./historical-pins.js";
import { historicalAuthenticationRefused } from "./historical-authentication-readers.js";

/** A display contract only. These lines cannot issue material or accounting authority. */
export function historicalJupiterRetirementConsentLines(operationId: string): readonly string[] {
  if (!HISTORICAL_JUPITER_IDS.some(id => id === operationId)) historicalAuthenticationRefused();
  return Object.freeze([
    "Conservative Jupiter historical retirement accounting",
    `Operation ${operationId}; owner ${HISTORICAL_JUPITER_PAYER}`,
    "Book exactly 6000000 total lamports as conservative USED accounting, including the existing 1000000-lamport hold.",
    "The active owner policy must admit the full 6000000-lamport per-operation amount.",
    "This requires 5000000 additional lamports of current daily capacity under the active owner policy.",
    "The actual transaction outcome and actual expense remain unknown; the transaction may have been submitted.",
    "Authenticate the retained signed material and read-only future-invalidity evidence before committing one immutable accounting record.",
    "No chain payment, new signing, resubmission or historical non-submission verdict is authorized.",
  ]);
}
