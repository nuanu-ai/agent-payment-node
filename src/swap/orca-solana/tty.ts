import { chainDisplay } from "../../chain-policy.js";
import { ApnError } from "../../errors.js";
import type { GuardedSwapApprovalIntent } from "../runtime.js";
import { assertSwapMaterialMatchesIntent, requiredDisplay as required } from "../tty-consent.js";
import { orcaPlanSides } from "./instructions.js";
import { ORCA_TOKEN_EXECUTION_SCHEMA, type OrcaTokenExecution, type SavedOrcaQuoteStore } from "./material.js";
import { ORCA_SOL_USDC_POOL, ORCA_SOLANA_CHAIN, WHIRLPOOL_PROGRAM } from "./pins.js";

/** The exact foreground screen for one guarded Orca swap (consent: TtyGuardedSwapApproval "orca"). */
export async function orcaApprovalScreen(quotes: Pick<SavedOrcaQuoteStore, "load">, intent: GuardedSwapApprovalIntent): Promise<readonly string[]> {
  const material = await quotes.load(intent.quoteHash);
  if (material === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Prepared swap quote was not found.");
  assertSwapMaterialMatchesIntent(material, intent, { deadline: false });
  if (material.execution.schemaVersion === ORCA_TOKEN_EXECUTION_SCHEMA) return tokenScreen(material.execution, intent);
  const execution = material.execution, swap = execution.evidence.swap, fees = intent.gasOrEnergy;
  return [
    `Agent Payment Node guarded swap approval: Solana mainnet (${ORCA_SOLANA_CHAIN}), Orca Whirlpool, keyless`,
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
    ...closing(intent),
  ];
}

function tokenScreen(execution: OrcaTokenExecution, intent: GuardedSwapApprovalIntent): readonly string[] {
  const pool = orcaPlanSides(execution.plan).pool, plan = execution.plan, fees = intent.gasOrEnergy, view = execution.evidence.pool;
  const created = execution.evidence.owner.destinationAccountExists ? "" : ", created in this transaction";
  return [
    `Agent Payment Node guarded swap approval: Solana mainnet (${ORCA_SOLANA_CHAIN}), Orca Whirlpool, keyless`,
    `Profile: ${intent.profile}`, `Operation: ${intent.operationId}`, `Signer and fee payer (local wallet, non-custodial): ${intent.account}`,
    `You send: ${chainDisplay(intent.inputAmountAtomic, pool.decimalsA)} ${pool.symbolA} (${intent.inputAmountAtomic} atomic), exact input, from your token account ${plan.sourceAccount}`,
    `${pool.symbolB} goes to your own token account ${plan.destinationAccount}${created}`,
    `Expected in: ${chainDisplay(intent.expectedOutputAtomic, pool.decimalsB)} ${pool.symbolB} (${intent.expectedOutputAtomic} atomic, pool state at slot ${execution.evidence.slot})`,
    `Minimum in: ${chainDisplay(intent.minimumOutputAtomic, pool.decimalsB)} ${pool.symbolB} (${intent.minimumOutputAtomic} atomic); the Whirlpool program fails the swap below this`,
    `Slippage cap: ${intent.slippageBps} basis points; price impact vs pool spot after the ${view.feeRate / 10_000}% LP fee: ${execution.evidence.swap.priceImpactBps} basis points`,
    `Pool: ${pool.pool} (${pool.symbolA}/${pool.symbolB}, tick spacing ${pool.tickSpacing}); program: Orca Whirlpool ${WHIRLPOOL_PROGRAM}`,
    `Compute unit limit: ${required(fees, "computeUnitLimit")}; price: ${required(fees, "computeUnitPriceMicroLamports")} micro-lamports per unit`,
    `Network fee: ${required(fees, "networkFeeLamports")} lamports; new ${pool.symbolB} account rent: ${required(fees, "destinationAccountRentLamports")} lamports`,
    `Maximum SOL leaving the wallet (fee and rent only): ${chainDisplay(required(fees, "maximumSolSpendLamports"), 9)} SOL (${required(fees, "maximumSolSpendLamports")} lamports)`,
    "Token approval cap: 0 (you sign the swap yourself; no token allowance or delegate is created)",
    ...closing(intent),
  ];
}

function closing(intent: GuardedSwapApprovalIntent): readonly string[] {
  return [`Approval window ends: ${intent.deadline}`,
    `Quote: ${intent.quoteHash}`, `Policy: ${intent.policyDigest}`, `Mechanism: ${intent.mechanismDigest}`,
    "After you approve, APN takes a fresh blockhash, re-simulates these exact instructions, signs locally and sends once.",
    "After that single send, status only observes this exact signature."];
}
