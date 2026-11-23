import { chainDisplay } from "../../chain-policy.js";
import { ApnError } from "../../errors.js";
import type { GuardedSwapApprovalIntent } from "../runtime.js";
import { assertSwapMaterialMatchesIntent, requiredDisplay as required } from "../tty-consent.js";
import type { SavedUniswapQuoteStore } from "./material.js";
import { uniswapNativeLaneOf } from "./native-lane.js";

/**
 * The exact foreground screen for one guarded native-input Uniswap swap (consent: TtyGuardedSwapApproval "uniswap"). The
 * quote's own chain names the lane: its network, native coin, wrapped token, router and token standard.
 */
export async function uniswapApprovalScreen(quotes: Pick<SavedUniswapQuoteStore, "load">, intent: GuardedSwapApprovalIntent): Promise<readonly string[]> {
  const material = await quotes.load(intent.quoteHash);
  if (material === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Prepared swap quote was not found.");
  const quote = material.quote, pool = material.execution.evidence.pool, lane = uniswapNativeLaneOf(quote.sourceAsset.chain);
  if (lane === undefined) throw new ApnError("APN_STATE_CORRUPT", "Prepared swap quote names no native-input Uniswap lane.");
  const pair = lane.pair(quote.destinationAsset.identifier!), native = lane.nativeSymbol;
  assertSwapMaterialMatchesIntent(material, intent, { deadline: false });
  const gas = intent.gasOrEnergy, deadline = Math.floor(Date.parse(intent.deadline) / 1000);
  return [
    `Agent Payment Node guarded swap approval: ${lane.screenNetwork} (${lane.chain}), Uniswap V3, keyless`,
    `Profile: ${intent.profile}`, `Operation: ${intent.operationId}`, `Signer (local wallet, non-custodial): ${intent.account}`,
    `You send: ${chainDisplay(intent.inputAmountAtomic, 18)} ${native} (${intent.inputAmountAtomic} wei), native, exact input`,
    `Recipient of ${pair.outputSymbol}: ${intent.recipient}`,
    `Expected in: ${chainDisplay(intent.expectedOutputAtomic, pair.outputDecimals)} ${pair.outputSymbol} (${intent.expectedOutputAtomic} atomic, QuoterV2 at block ${quote.simulation.blockNumber})`,
    `Minimum in: ${chainDisplay(intent.minimumOutputAtomic, pair.outputDecimals)} ${pair.outputSymbol} (${intent.minimumOutputAtomic} atomic); the router reverts below this`,
    `Slippage cap: ${intent.slippageBps} basis points`,
    `Price impact vs pool spot after the ${pool.fee / 10_000}% LP fee: ${pool.priceImpactBps} basis points`,
    `Pool: ${pool.pool} (${lane.wrappedSymbol}/${pair.outputSymbol}, fee tier ${pool.fee}); router: ${lane.routerLabel} ${lane.router}`,
    `Gas limit: ${gas.gasLimit}; max fee per gas: ${gas.maxFeePerGas} wei; max priority fee per gas: ${gas.maxPriorityFeePerGas} wei`,
    `Maximum network fee: ${chainDisplay(required(gas, "maximumGasCostWei"), 18)} ${native} (${required(gas, "maximumGasCostWei")} wei)`,
    `Token approval cap: ${material.approvalCapAtomic} (native ${native} input needs no ${lane.tokenStandard} or Permit2 allowance)`,
    `Deadline: ${intent.deadline} (unix ${deadline})`,
    `Quote: ${intent.quoteHash}`, `Policy: ${intent.policyDigest}`, `Mechanism: ${intent.mechanismDigest}`,
    "APN signs locally and sends exactly once. After that attempt, status only observes this exact transaction.",
  ];
}
