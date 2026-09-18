import { canonicalJson, domainHash } from "../../canonical.js";
import { approvalCode } from "../../approval-code.js";
import { chainDisplay } from "../../chain-policy.js";
import { ApnError } from "../../errors.js";
import { exactChainConsent } from "../../tty-approval.js";
import { sealGuardedSwapApproval } from "../runtime.js";
import { UNISWAP_ROUTER } from "../uniswap-pin.js";
import { uniswapV3Pair } from "./pins.js";
/** The exact foreground screen for one guarded Uniswap swap. The owner types a short code bound to every line. */
export class TtyUniswapSwapApproval {
    quotes;
    clock;
    options;
    constructor(quotes, clock, options = {}) {
        this.quotes = quotes;
        this.clock = clock;
        this.options = options;
    }
    async approve(intent) {
        const lines = await uniswapApprovalScreen(this.quotes, intent);
        const code = uniswapApprovalCode(intent, lines);
        await exactChainConsent(lines, code, intent.deadline, this.options);
        // Consent time is read after the human answered, never the command start time.
        return sealGuardedSwapApproval(intent, this.clock.now(), domainHash("apn.uniswap-tty-consent.v1", canonicalJson({ lines, code })));
    }
}
export function uniswapApprovalCode(intent, lines) {
    return approvalCode("swap", intent.operationId, domainHash("apn.uniswap-approval-screen.v1", canonicalJson({ intent, lines })));
}
export async function uniswapApprovalScreen(quotes, intent) {
    const material = await quotes.load(intent.quoteHash);
    if (material === null)
        throw new ApnError("APN_OPERATION_NOT_FOUND", "Prepared swap quote was not found.");
    const quote = material.quote, pool = material.execution.evidence.pool, pair = uniswapV3Pair(quote.destinationAsset.identifier);
    if (quote.quoteHash !== intent.quoteHash || quote.inputAmountAtomic !== intent.inputAmountAtomic ||
        quote.expectedOutputAtomic !== intent.expectedOutputAtomic || quote.minimumOutputAtomic !== intent.minimumOutputAtomic ||
        quote.slippageBps !== intent.slippageBps || quote.account !== intent.account || quote.recipient !== intent.recipient ||
        canonicalJson(material.gasOrEnergy) !== canonicalJson(intent.gasOrEnergy)) {
        throw new ApnError("APN_OPERATION_BLOCKED", "Prepared swap material does not match the approval intent.", { reason: "swap_material_drift" });
    }
    const gas = intent.gasOrEnergy, deadline = Math.floor(Date.parse(intent.deadline) / 1000);
    return [
        "Agent Payment Node guarded swap approval: Ethereum mainnet (eip155:1), Uniswap V3, keyless",
        `Profile: ${intent.profile}`, `Operation: ${intent.operationId}`, `Signer (local wallet, non-custodial): ${intent.account}`,
        `You send: ${chainDisplay(intent.inputAmountAtomic, 18)} ETH (${intent.inputAmountAtomic} wei), native, exact input`,
        `Recipient of ${pair.outputSymbol}: ${intent.recipient}`,
        `Expected in: ${chainDisplay(intent.expectedOutputAtomic, pair.outputDecimals)} ${pair.outputSymbol} (${intent.expectedOutputAtomic} atomic, QuoterV2 at block ${quote.simulation.blockNumber})`,
        `Minimum in: ${chainDisplay(intent.minimumOutputAtomic, pair.outputDecimals)} ${pair.outputSymbol} (${intent.minimumOutputAtomic} atomic); the router reverts below this`,
        `Slippage cap: ${intent.slippageBps} basis points`,
        `Price impact vs pool spot after the ${pool.fee / 10_000}% LP fee: ${pool.priceImpactBps} basis points`,
        `Pool: ${pool.pool} (WETH/${pair.outputSymbol}, fee tier ${pool.fee}); router: Universal Router 2.2.0 ${UNISWAP_ROUTER}`,
        `Gas limit: ${gas.gasLimit}; max fee per gas: ${gas.maxFeePerGas} wei; max priority fee per gas: ${gas.maxPriorityFeePerGas} wei`,
        `Maximum network fee: ${chainDisplay(required(gas, "maximumGasCostWei"), 18)} ETH (${required(gas, "maximumGasCostWei")} wei)`,
        `Token approval cap: ${material.approvalCapAtomic} (native ETH input needs no ERC20 or Permit2 allowance)`,
        `Deadline: ${intent.deadline} (unix ${deadline})`,
        `Quote: ${intent.quoteHash}`, `Policy: ${intent.policyDigest}`, `Mechanism: ${intent.mechanismDigest}`,
        "APN signs locally and sends exactly once. After that attempt, status only observes this exact transaction.",
    ];
}
function required(record, key) {
    const value = record[key];
    if (value === undefined)
        throw new ApnError("APN_STATE_CORRUPT", `Guarded swap display lacks ${key}.`);
    return value;
}
//# sourceMappingURL=tty.js.map