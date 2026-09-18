import { canonicalJson, domainHash } from "../../canonical.js";
import { approvalCode } from "../../approval-code.js";
import { chainDisplay } from "../../chain-policy.js";
import { ApnError } from "../../errors.js";
import type { ClockPort } from "../../ports.js";
import { exactChainConsent, type TtyTransferApprovalOptions } from "../../tty-approval.js";
import { sealGuardedSwapApproval, type GuardedSwapApprovalArtifact, type GuardedSwapApprovalIntent,
  type GuardedSwapForegroundApprovalPort } from "../runtime.js";
import type { SavedOrcaQuoteStore } from "./material.js";
import { ORCA_SOL_USDC_POOL, WHIRLPOOL_PROGRAM } from "./pins.js";

/** The exact foreground screen for one guarded Orca swap. The owner types a short code bound to every line. */
export class TtyOrcaSwapApproval implements GuardedSwapForegroundApprovalPort {
  constructor(private readonly quotes: Pick<SavedOrcaQuoteStore, "load">, private readonly clock: ClockPort,
    private readonly options: TtyTransferApprovalOptions = {}) {}

  async approve(intent: GuardedSwapApprovalIntent): Promise<GuardedSwapApprovalArtifact> {
    const lines = await orcaApprovalScreen(this.quotes, intent), code = orcaApprovalCode(intent, lines);
    await exactChainConsent(lines, code, intent.deadline, this.options);
    // Consent time is read after the human answered, never the command start time.
    return sealGuardedSwapApproval(intent, this.clock.now(), domainHash("apn.orca-tty-consent.v1", canonicalJson({ lines, code })));
  }
}

export function orcaApprovalCode(intent: GuardedSwapApprovalIntent, lines: readonly string[]): string {
  return approvalCode("swap", intent.operationId, domainHash("apn.orca-approval-screen.v1", canonicalJson({ intent, lines })));
}

export async function orcaApprovalScreen(quotes: Pick<SavedOrcaQuoteStore, "load">, intent: GuardedSwapApprovalIntent): Promise<readonly string[]> {
  const material = await quotes.load(intent.quoteHash);
  if (material === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Prepared swap quote was not found.");
  const quote = material.quote, execution = material.execution, swap = execution.evidence.swap, fees = intent.gasOrEnergy;
  if (quote.quoteHash !== intent.quoteHash || quote.inputAmountAtomic !== intent.inputAmountAtomic ||
      quote.expectedOutputAtomic !== intent.expectedOutputAtomic || quote.minimumOutputAtomic !== intent.minimumOutputAtomic ||
      quote.slippageBps !== intent.slippageBps || quote.account !== intent.account || quote.recipient !== intent.recipient ||
      canonicalJson(material.gasOrEnergy) !== canonicalJson(fees)) {
    throw new ApnError("APN_OPERATION_BLOCKED", "Prepared swap material does not match the approval intent.", { reason: "swap_material_drift" });
  }
  return [
    "Agent Payment Node guarded swap approval: Solana mainnet (solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp), Orca Whirlpool, keyless",
    `Profile: ${intent.profile}`, `Operation: ${intent.operationId}`, `Signer and fee payer (local wallet, non-custodial): ${intent.account}`,
    `You send: ${chainDisplay(intent.inputAmountAtomic, 9)} SOL (${intent.inputAmountAtomic} lamports), exact input, wrapped to wSOL inside this transaction`,
    `USDC goes to your own token account ${execution.plan.usdcAccount}; the temporary wSOL account ${execution.plan.wsolAccount} is closed back to you`,
    `Expected in: ${chainDisplay(intent.expectedOutputAtomic, 6)} USDC (${intent.expectedOutputAtomic} atomic, pool state at slot ${execution.evidence.slot})`,
    `Minimum in: ${chainDisplay(intent.minimumOutputAtomic, 6)} USDC (${intent.minimumOutputAtomic} atomic); the Whirlpool program fails the swap below this`,
    `Slippage cap: ${intent.slippageBps} basis points; price impact vs pool spot after the 0.04% LP fee: ${swap.priceImpactBps} basis points`,
    `Pool: ${ORCA_SOL_USDC_POOL} (SOL/USDC, tick spacing 4); program: Orca Whirlpool ${WHIRLPOOL_PROGRAM}`,
    `Compute unit limit: ${required(fees, "computeUnitLimit")}; price: ${required(fees, "computeUnitPriceMicroLamports")} micro-lamports per unit`,
    `Network fee: ${required(fees, "networkFeeLamports")} lamports; new USDC account rent: ${required(fees, "usdcAccountRentLamports")} lamports`,
    `Maximum SOL leaving the wallet: ${chainDisplay(required(fees, "maximumSolSpendLamports"), 9)} SOL (${required(fees, "maximumSolSpendLamports")} lamports)`,
    "Token approval cap: 0 (native SOL input needs no token allowance or delegate)",
    `Approval window ends: ${intent.deadline}`,
    `Quote: ${intent.quoteHash}`, `Policy: ${intent.policyDigest}`, `Mechanism: ${intent.mechanismDigest}`,
    "After you approve, APN takes a fresh blockhash, re-simulates these exact instructions, signs locally and sends once.",
    "After that single send, status only observes this exact signature.",
  ];
}

function required(record: Readonly<Record<string, string>>, key: string): string {
  const value = record[key];
  if (value === undefined) throw new ApnError("APN_STATE_CORRUPT", `Guarded swap display lacks ${key}.`);
  return value;
}
