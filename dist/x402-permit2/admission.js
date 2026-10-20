import { getAddress } from "viem";
import { X402_EXACT_PERMIT2_PROXY_CODE_HASH, X402_PERMIT2_MECHANISM } from "./registry.js";
/**
 * The offers the owner's active allowlist policy admits for Permit2: an EVM chain row naming the offer's network, a token
 * row naming its contract with the x402 rail on and exactly the `x402-exact-permit2` mechanism pin. Symbol, decimals and
 * network name come from that row; the EIP-2612 domain only from the seller's name/version hint (a sponsored permit
 * needs it, as the seller's facilitator verifies against it), and the read port proves it on chain before use.
 */
export function admittedPermit2Assets(active) {
    return (network, token, extra) => {
        const chain = active.registry.chains.find((row) => row.family === "evm" && row.chain === network);
        const match = /^eip155:([1-9][0-9]{0,15})$/u.exec(network);
        if (chain === undefined || match === null || !Number.isSafeInteger(Number(match[1])))
            return undefined;
        const row = chain.assets.find((candidate) => candidate.kind === "token" && candidate.identifier?.toLowerCase() === token.toLowerCase());
        if (row === undefined || !permit2Row(row))
            return undefined;
        const hints = typeof extra.name === "string" && typeof extra.version === "string" ? { name: extra.name, version: extra.version } : null;
        return { chain: network, chainId: Number(match[1]), networkName: chain.name,
            token: getAddress(row.identifier), symbol: row.symbol, decimals: row.decimals,
            tokenDomain: hints, tokenDomainSeparator: null,
            proxyCodeHash: X402_EXACT_PERMIT2_PROXY_CODE_HASH };
    };
}
function permit2Row(row) {
    const pin = row.mechanismPins?.x402;
    return row.rails.x402 && pin !== undefined && pin.provider === X402_PERMIT2_MECHANISM.provider &&
        pin.reference.toLowerCase() === X402_PERMIT2_MECHANISM.reference.toLowerCase();
}
//# sourceMappingURL=admission.js.map