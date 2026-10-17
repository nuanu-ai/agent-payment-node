import { SOLANA_GENESIS } from "./chain-policy.js";
import { TRON_GENESIS } from "./tron/constants.js";
import { bridgeDomains } from "./operation-index/adapters/bridge.js";
import { circleDomains } from "./operation-index/adapters/circle.js";
import { directDomains } from "./operation-index/adapters/direct.js";
import { facilitatorGaslessDomains, gaslessDomains, metaMaskGaslessDomains, smartAccountGaslessDomains } from "./operation-index/adapters/gasless.js";
import { megaGaszipDomains, seiGaszipDomains } from "./operation-index/adapters/gaszip.js";
import { merchantDomains } from "./operation-index/adapters/merchant.js";
import { permit2Domains } from "./operation-index/adapters/permit2.js";
import { railDomains } from "./operation-index/adapters/rail.js";
import { relayDomains } from "./operation-index/adapters/relay.js";
import { x402Domains } from "./operation-index/adapters/x402.js";
export function evmConflictDomain(chainId, account) {
    const network = String(chainId);
    if (!/^[1-9][0-9]{0,15}$/u.test(network) || !/^0x[0-9a-fA-F]{40}$/u.test(account))
        throw new Error("Invalid EVM conflict domain.");
    return { family: "evm", network, account: account.toLowerCase() };
}
/**
 * Local EIP-3009 x402 spends by its own random nonce, so concurrent purchases may share one account. It still excludes
 * every family that uses the account nonce or an EIP-7702 designation (which switches USDC signature checks to
 * ERC-1271), and spends share the balance.
 */
export function sharedEvmConflictDomain(chainId, account) {
    return { ...evmConflictDomain(chainId, account), shared: true };
}
export function railConflictDomain(rail, account) {
    if ((rail !== "solana" && rail !== "tron") || !/^[A-Za-z0-9]{32,64}$/u.test(account))
        throw new Error("Invalid rail conflict domain.");
    return { family: rail, network: rail === "solana" ? SOLANA_GENESIS : TRON_GENESIS, account };
}
/** LI.FI's own identifier for Solana mainnet. It is not an EVM chain id and never names one. */
export const SOLANA_BRIDGE_CHAIN_ID = "1151111081099710";
const SOLANA_BASE58_ACCOUNT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/u;
/**
 * A bridge claims the lock of the chain it signs on. Every EVM source keeps the EVM domain it has
 * always taken; a Solana source takes the same `solana:<genesis>:<address>` key a direct Solana
 * transfer takes, so the two collide on one account and never collide across families.
 */
export function bridgeConflictDomain(chainId, account) {
    if (String(chainId) !== SOLANA_BRIDGE_CHAIN_ID)
        return evmConflictDomain(chainId, account);
    if (!SOLANA_BASE58_ACCOUNT.test(account))
        throw new Error("Invalid Solana bridge conflict domain.");
    return railConflictDomain("solana", account);
}
export function conflictDomainKey(domain) {
    return `${domain.family}:${domain.network}:${domain.account}`;
}
/** An unreadable domain list yields no keys; the caller then blocks the whole profile. */
export function conflictDomainKeys(domains) {
    try {
        return new Set(domains().map(conflictDomainKey));
    }
    catch {
        return new Set();
    }
}
/** Keys the caller claims as shared; an unreadable list yields none, so every held claim stays exclusive to it. */
export function sharedConflictDomainKeys(domains) {
    try {
        return new Set(domains().filter(domain => domain.shared === true).map(conflictDomainKey));
    }
    catch {
        return new Set();
    }
}
/**
 * Null marks a record whose network or account cannot be read; the caller then blocks the whole profile. Each family's
 * domains live in its operation-index adapter (src/operation-index/adapters), which the guard reads through.
 */
export function storedOperationDomains(operation) {
    try {
        switch (operation.kind) {
            case "sei_gaszip": return seiGaszipDomains(operation.record);
            case "mega_gaszip": return megaGaszipDomains(operation.record);
            case "circle_route": return circleDomains(operation.record);
            case "permit2_production": return permit2Domains(operation.record);
            case "merchant_x402": return merchantDomains(operation.record);
            case "relay_unsigned": return relayDomains(operation.record);
            case "direct_transfer": return directDomains(operation.record);
            case "x402_fetch": return x402Domains(operation);
            case "rail_transfer": return railDomains(operation.record);
            case "bridge_route": return bridgeDomains(operation.record);
            case "gasless_transfer": return gaslessDomains(operation.record);
            case "metamask_gasless_transfer": return metaMaskGaslessDomains(operation.record);
            case "facilitator_gasless_transfer": return facilitatorGaslessDomains(operation.record);
            case "smart_account_gasless_transfer": return smartAccountGaslessDomains(operation.record);
        }
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=operation-conflict-domain.js.map