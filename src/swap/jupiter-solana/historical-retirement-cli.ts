import { randomUUID } from "node:crypto";
import { OUTPUT_VERSION } from "../../constants.js";
import type { OutputEnvelope } from "../../commands.js";
import { HISTORICAL_JUPITER_IDS } from "./historical-pins.js";

const PATH = ["swap", "solana", "jupiter", "historical-retire"] as const;
const COMMAND = "swap.solana.jupiter.historical-retire";

/** CLI-only finite route; no command catalog, SDK or MCP admission. */
export function isHistoricalJupiterRetirementCli(argv: readonly string[]): boolean {
  return PATH.every((part, index) => argv[index] === part);
}

/** Validate before resolving a root, constructing custody or opening any state. */
export async function executeHistoricalJupiterRetirementCli(
  argv: readonly string[], stateRoot: () => string,
): Promise<OutputEnvelope> {
  const base = { version: OUTPUT_VERSION, request_id: randomUUID(), command: COMMAND,
    operation: null, receipt: null, next_actions: [] };
  if (!isHistoricalJupiterRetirementCli(argv) || argv.length !== 6 || argv[4] !== "--operation" ||
      !HISTORICAL_JUPITER_IDS.some(id => id === argv[5])) {
    return { ...base, ok: false, proof_class: "classified_failure", data: null,
      error: { code: "APN_INVALID_INPUT", message: "Specify exactly one admitted historical Jupiter retirement operation." } };
  }
  try {
    const root = stateRoot();
    const { executeJupiterHistoricalRetirement } = await import("./historical-retirement-owner.js");
    const result = await executeJupiterHistoricalRetirement(argv[5]!, root);
    return { ...base, ok: true, proof_class: "conservative_historical_retirement_only", error: null,
      data: { operationId: argv[5]!, scope: "Conservative accounting only; actual transaction outcome and expense remain unknown.",
        retirement: { status: result.status, operationId: result.operationId, profile: result.profile,
          accountingAt: result.accountingAt, conservativeNativeAmount: result.conservativeNativeAmount,
          additionalAdmissionNativeAmount: result.additionalAdmissionNativeAmount, effectAt: result.effectAt,
          actualNativeFee: result.actualNativeFee, transactionOutcome: result.transactionOutcome,
          transactionMayHaveBeenSubmitted: result.transactionMayHaveBeenSubmitted,
          retirementRecordHash: result.retirementRecordHash, idempotentRecovered: result.idempotentRecovered } } };
  } catch {
    return { ...base, ok: false, proof_class: "classified_failure", data: null,
      error: { code: "APN_OPERATION_BLOCKED", message: "Historical Jupiter conservative retirement is unavailable." } };
  }
}
