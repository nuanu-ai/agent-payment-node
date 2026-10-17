import { chainDisplay } from "../../chain-policy.js";
import { ApnError } from "../../errors.js";
import { assertSwapMaterialMatchesIntent, requiredDisplay as required } from "../tty-consent.js";
import { ORCA_SOL_USDC_POOL, ORCA_SOLANA_CHAIN, WHIRLPOOL_PROGRAM } from "./pins.js";
/** The exact foreground screen for one guarded Orca swap (consent: TtyGuardedSwapApproval "orca"). */
export async function orcaApprovalScreen(quotes, intent) {
    const material = await quotes.load(intent.quoteHash);
    if (material === null)
        throw new ApnError("APN_OPERATION_NOT_FOUND", "Prepared swap quote was not found.");
    const execution = material.execution, swap = execution.evidence.swap, fees = intent.gasOrEnergy;
    assertSwapMaterialMatchesIntent(material, intent, { deadline: false });
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
        `Approval window ends: ${intent.deadline}`,
        `Quote: ${intent.quoteHash}`, `Policy: ${intent.policyDigest}`, `Mechanism: ${intent.mechanismDigest}`,
        "After you approve, APN takes a fresh blockhash, re-simulates these exact instructions, signs locally and sends once.",
        "After that single send, status only observes this exact signature.",
    ];
}
//# sourceMappingURL=tty.js.map