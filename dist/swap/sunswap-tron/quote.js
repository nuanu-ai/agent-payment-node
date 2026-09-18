import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { createSwapQuote } from "../quote.js";
import { SUNSWAP_TRON_CHAIN, SUNSWAP_USDT, loadSunSwapPinCatalog } from "./catalog.js";
import { priceSunSwapV2Market, validateSunSwapV2Market } from "./market.js";
/** The generic quote carries on-chain V2 evidence only: the route hash binds router, pair, path, pins, reserves and block. */
export function createSunSwapQuoteSnapshot(input) {
    loadSunSwapPinCatalog();
    if (!isPlainRecord(input) || !exactKeys(input, ["profile", "account", "recipient", "slippageBps", "ownerSlippageCapBps", "effectiveAt",
        "expiresAt", "unsignedTransactionPayloadHash", "market", "simulation"]) || input.recipient !== input.account) {
        throw new ApnError("APN_INVALID_INPUT", "SunSwap V2 quote input is invalid; the recipient must be the owner account.");
    }
    const market = validateSunSwapV2Market(input.market, "input");
    const pricing = priceSunSwapV2Market(market, input.slippageBps, input.ownerSlippageCapBps);
    if (!isPlainRecord(input.simulation) || input.simulation.blockHash !== `0x${market.referenceBlock.id}` ||
        input.simulation.blockNumber !== market.referenceBlock.number) {
        throw new ApnError("APN_OPERATION_BLOCKED", "SunSwap simulation is not bound to the recorded quote block.", { reason: "sunswap_block_binding" });
    }
    return createSwapQuote({ profile: input.profile, account: input.account, recipient: input.recipient,
        sourceAsset: { chain: SUNSWAP_TRON_CHAIN, kind: "native", identifier: null },
        destinationAsset: { chain: SUNSWAP_TRON_CHAIN, kind: "token", identifier: SUNSWAP_USDT },
        inputAmountAtomic: market.amountInAtomic, expectedOutputAtomic: pricing.expectedOutputAtomic,
        minimumOutputAtomic: pricing.minimumOutputAtomic, slippageBps: input.slippageBps, effectiveAt: input.effectiveAt,
        expiresAt: input.expiresAt, providerResponseHash: sunSwapOnChainEvidenceHash(market), routeHash: market.routeHash,
        unsignedTransactionPayloadHash: input.unsignedTransactionPayloadHash, simulation: input.simulation });
}
/** No provider response exists: this digest names the raw on-chain constant results and the pinned code hashes read. */
export function sunSwapOnChainEvidenceHash(market) {
    return domainHash("apn.sunswap-tron-v2-onchain-evidence.v1", canonicalJson({ rpcOriginHash: market.rpcOriginHash,
        referenceBlock: market.referenceBlock, headBlockNumber: market.headBlockNumber, codeHashes: market.codeHashes,
        amountsOutResultHex: market.amountsOutResultHex, reservesResultHex: market.reservesResultHex }));
}
//# sourceMappingURL=quote.js.map