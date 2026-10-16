import { canonicalJson, domainHash, sha256 } from "./canonical.js";
import { x402Network } from "./x402-network.js";
import { assertX402RpcChain } from "./x402-service-rpc.js";
const UNUSED_EXPIRY_V2 = "apn.x402.unused-expiry-evidence.v2";
/**
 * An EIP-3009 authorization executes only while block.timestamp < validBefore, and its
 * (authorizer, nonce) state flips to used exactly once. A finalized block at or after validBefore
 * that still reads "unused" therefore proves the signed authorization can never move money.
 * Returns null when the chain cannot prove it yet.
 */
export async function readX402UnusedExpiryEvidence(rpc, operation) {
    if (operation.selectedOffer.resolved.assetTransferMethod !== "eip3009")
        return null;
    const chain = await assertX402RpcChain(rpc, x402Network(operation.network).chainId);
    const state = await rpc.getX402AuthorizationState(operation.wallet, operation.authorization.nonce, { tag: "finalized" });
    if (state.value || state.blockTag !== "finalized" || state.rpcOrigin !== chain.rpcOrigin ||
        !/^(?:0|[1-9][0-9]*)$/u.test(state.blockTimestamp) ||
        BigInt(state.blockTimestamp) < BigInt(operation.authorization.validBefore))
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
//# sourceMappingURL=x402-expiry-proof.js.map