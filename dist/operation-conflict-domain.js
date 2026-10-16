import { SOLANA_GENESIS } from "./chain-policy.js";
import { TRON_GENESIS } from "./tron/constants.js";
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
export { assertUsdtConflictDomainsAvailable } from "./gasless-usdt/account-conflict.js";
/** Null marks a record whose network or account cannot be read; the caller then blocks the whole profile. */
export function storedOperationDomains(operation) {
    try {
        if (operation.kind === "sei_gaszip")
            return [evmConflictDomain(8453, operation.record.owner.address),
                evmConflictDomain(1329, operation.record.owner.address)];
        if (operation.kind === "circle_route")
            return [evmConflictDomain(42161, operation.record.sourceCustody.walletAddress),
                evmConflictDomain(operation.record.destinationChain, operation.record.destinationCustody.walletAddress)];
        if (operation.kind === "mega_gaszip")
            return [evmConflictDomain(8453, operation.record.owner.address)];
        if (operation.kind === "permit2_production")
            return [evmConflictDomain(43114, operation.record.material.wallet.account)];
        if (operation.kind === "merchant_x402")
            return [evmConflictDomain(4326, operation.record.custody.walletAddress)];
        if (operation.kind === "relay_unsigned")
            return [evmConflictDomain(operation.record.sourceChainId, operation.record.sourceAccount)];
        if (operation.kind === "direct_transfer")
            return [evmConflictDomain(operation.record.chainId, operation.record.walletAddress)];
        if (operation.kind === "x402_fetch") {
            // A local EIP-3009 authorization spends by its own random nonce: it shares the account with other purchases only.
            if (operation.strategy === "local" && operation.record.selectedOffer.resolved.assetTransferMethod === "eip3009") {
                return [sharedEvmConflictDomain(operation.record.chainId, operation.record.wallet)];
            }
            // Provider-atomic x402 is Base-only; its record carries the network as CAIP-2 instead of a chain id.
            return [operation.strategy === "local" ? evmConflictDomain(operation.record.chainId, operation.record.wallet)
                    : evmConflictDomain(8453, operation.record.provider.payer)];
        }
        if (operation.kind === "rail_transfer")
            return [railConflictDomain(operation.record.account.rail, operation.record.account.address)];
        if (operation.kind === "bridge_route") {
            return [bridgeConflictDomain(operation.record.intent.sourceDeployment.chainId, operation.record.intent.owner.address)];
        }
        if (operation.kind === "gasless_transfer") {
            return [evmConflictDomain(operation.record.intent.request.chainId, operation.record.intent.owner.address)];
        }
        if (operation.kind === "metamask_gasless_transfer") {
            return [evmConflictDomain(operation.record.intent.request.chainId, operation.record.intent.binding.address)];
        }
        if (operation.kind === "facilitator_gasless_transfer") {
            return [evmConflictDomain(operation.record.intent.request.chainId, operation.record.intent.owner.address)];
        }
        return [evmConflictDomain(operation.record.intent.request.chainId, operation.record.intent.binding.ownerAddress)];
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=operation-conflict-domain.js.map