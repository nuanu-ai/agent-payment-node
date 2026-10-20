import { canonicalJson, domainHash, sha256 } from "./canonical.js";
import { ApnError } from "./errors.js";
import { x402AssetOf, x402ExpiredAt } from "./x402-network.js";
import { assertX402RpcChain } from "./x402-service-rpc.js";
const UNUSED_EXPIRY_V2 = "apn.x402.unused-expiry-evidence.v2";
/**
 * An EIP-3009 authorization executes only while block.timestamp < validBefore, and its
 * (authorizer, nonce) state flips to used exactly once. A finalized block at or after validBefore
 * that still reads "unused" therefore proves the signed authorization can never move money.
 * Permit2 reverts only when block.timestamp > deadline, so it can still settle in a block stamped
 * exactly at the deadline (chains make several blocks per second): its proof needs a later block.
 * Returns null when the chain cannot prove it yet.
 */
export async function readX402UnusedExpiryEvidence(rpc, operation) {
    const method = operation.selectedOffer.resolved.assetTransferMethod;
    if (method !== "eip3009" && method !== "permit2")
        return null;
    const chain = await assertX402RpcChain(rpc, x402AssetOf(operation).chainId);
    // A Permit2 witness transfer likewise executes only before its deadline (validBefore) and consumes its nonce bit once.
    const state = await x402NonceState(rpc, operation, { tag: "finalized" });
    if (state.value || state.blockTag !== "finalized" || state.rpcOrigin !== chain.rpcOrigin ||
        !/^(?:0|[1-9][0-9]*)$/u.test(state.blockTimestamp) ||
        !x402ExpiredAt(method, BigInt(state.blockTimestamp), BigInt(operation.authorization.validBefore)))
        return null;
    const body = {
        schemaVersion: UNUSED_EXPIRY_V2,
        network: operation.network,
        chainId: operation.chainId,
        token: operation.token,
        validBefore: operation.authorization.validBefore,
        finalizedHead: {
            number: state.blockNumber,
            hash: state.blockHash,
            timestamp: state.blockTimestamp,
            observedAt: state.observedAt,
        },
        authorizationState: {
            value: false,
            blockNumber: state.blockNumber,
            blockHash: state.blockHash,
            blockTag: "finalized",
            observedAt: state.observedAt,
        },
        rpcOriginHash: sha256(chain.rpcOrigin),
    };
    return { ...body, evidenceHash: domainHash(UNUSED_EXPIRY_V2, canonicalJson(body)) };
}
/** The one-shot nonce state an operation's method spends: EIP-3009 authorizationState, or Permit2's unordered nonce bit. */
export async function x402NonceState(rpc, operation, block) {
    if (operation.selectedOffer.resolved.assetTransferMethod !== "permit2") {
        return await rpc.getX402AuthorizationState(operation.wallet, operation.authorization.nonce, block);
    }
    if (rpc.getX402Permit2NonceState === undefined)
        throw new ApnError("APN_RPC_CONFIG", "RPC adapter lacks x402 Permit2 support.");
    return await rpc.getX402Permit2NonceState(operation.wallet, operation.authorization.nonce, block);
}
//# sourceMappingURL=x402-expiry-proof.js.map