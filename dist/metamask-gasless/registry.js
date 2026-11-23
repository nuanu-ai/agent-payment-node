import { canonicalJson, hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import { MM_DEPLOYMENTS as MM_CIRCLE_DEPLOYMENTS, MM_DEPLOYMENT_SOURCE_FILES } from "./registry-data.js";
import { MM_BSC_DEPLOYMENTS, MM_BSC_DEPLOYMENT_SOURCE_FILES } from "./registry-data-bsc.js";
import { MM_CHAINS, MM_EMPTY_CODE_HASH, MM_TOKEN_DECIMALS, MM_ZERO_ADDRESS } from "./model.js";
import { MM_REASON_CODES, mmFail } from "./reasons.js";
export { MM_CHAINS } from "./model.js";
export const MM_RPC_ENV = Object.freeze({
    1: "APN_ETHEREUM_RPC_URL", 10: "APN_OPTIMISM_RPC_URL", 56: "APN_BNB_RPC_URL", 137: "APN_POLYGON_RPC_URL",
    143: "APN_MONAD_RPC_URL", 1329: "APN_SEI_RPC_URL", 8453: "APN_BASE_RPC_URL",
    42161: "APN_ARBITRUM_RPC_URL", 59144: "APN_LINEA_RPC_URL",
});
export const MM_SENTINEL_SLUG = Object.freeze({
    1: "ethereum-mainnet", 10: "optimism-mainnet", 56: "bsc-mainnet", 137: "polygon-mainnet", 143: "monad-mainnet",
    1329: "sei-mainnet", 8453: "base-mainnet", 42161: "arbitrum-mainnet", 59144: "linea-mainnet",
});
/**
 * The symbol of every token a lane row has named, kept apart from the rows: a saved record shows its own token's
 * symbol even after a later release changes the rows. Read from each contract's symbol().
 */
const MM_TOKEN_SYMBOLS = Object.freeze({
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "USDC", "0x0b2c639c533813f4aa9d7837caf62653d097ff85": "USDC",
    "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": "USDC", "0x754704bc059f8c67012fed69bc8a327a5aafb603": "USDC",
    "0xe15fc38f6d8c56af07bbcbe3baf5708a2bf42392": "USDC", "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC",
    "0xaf88d065e77c8cc2239327c5edb3a432268e5831": "USDC", "0x176211869ca2b568f2a7d4ee941e073a821ee1ff": "USDC",
    "0x55d398326f99059ff775485246999027b3197955": "USDT", "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": "USDC",
});
/** Each evidence input with the rows it binds: a row's evidence hash covers its own input's files, never another's. */
const MM_EVIDENCE = [
    { sourceFiles: MM_DEPLOYMENT_SOURCE_FILES, deployments: MM_CIRCLE_DEPLOYMENTS },
    { sourceFiles: MM_BSC_DEPLOYMENT_SOURCE_FILES, deployments: MM_BSC_DEPLOYMENTS },
];
function freeze(value) {
    if (value !== null && typeof value === "object") {
        for (const item of Object.values(value))
            freeze(item);
        Object.freeze(value);
    }
    return value;
}
/** The rows in chain order, then in their evidence input's order. */
export const MM_DEPLOYMENTS = MM_CHAINS.flatMap(chainId => MM_EVIDENCE.flatMap(input => input.deployments.filter(entry => entry.row.chainId === chainId)));
const chainFacts = (row) => ({ chainId: row.chainId, network: row.network, finalityTag: row.finalityTag, protocol: row.protocol });
if (MM_DEPLOYMENTS.length !== MM_EVIDENCE.reduce((total, input) => total + input.deployments.length, 0) ||
    MM_EVIDENCE.some(input => input.deployments.some(entry => entry.deploymentEvidenceHash !== hashObject({
        purpose: "apn.metamask-gasless.deployment-evidence.v1", sourceFiles: input.sourceFiles, row: entry.row,
    }))) || MM_CHAINS.some(chainId => {
    const rows = MM_DEPLOYMENTS.filter(entry => entry.row.chainId === chainId).map(entry => entry.row);
    return rows.length === 0 || new Set(rows.map(row => row.token)).size !== rows.length ||
        rows.some(row => canonicalJson(chainFacts(row)) !== canonicalJson(chainFacts(rows[0])));
}) || MM_DEPLOYMENTS.some(({ row }) => !MM_TOKEN_DECIMALS.includes(row.decimals) ||
    !Object.hasOwn(MM_TOKEN_SYMBOLS, row.token) ||
    (row.tokenImplementationAddress === MM_ZERO_ADDRESS) !== (row.tokenImplementationCodeHash === MM_EMPTY_CODE_HASH))) {
    mmFail("mm_gasless_state_corrupt");
}
freeze(MM_DEPLOYMENT_SOURCE_FILES);
freeze(MM_BSC_DEPLOYMENT_SOURCE_FILES);
freeze(MM_CIRCLE_DEPLOYMENTS);
freeze(MM_BSC_DEPLOYMENTS);
freeze(MM_DEPLOYMENTS);
function rowsOf(chainId) {
    const rows = MM_DEPLOYMENTS.filter(entry => entry.row.chainId === chainId);
    return rows.length === 0 ? mmFail("mm_gasless_unsupported_chain") : rows;
}
/**
 * Static source-correlated input, never current account or mainnet payment acceptance. A chain with one token row needs
 * no token; a chain with several (56) needs the transfer token, and an unknown token is refused.
 */
export function mmRegistry(chainId, token) {
    const rows = rowsOf(chainId);
    if (token === undefined)
        return rows.length === 1 ? rows[0] : mmFail("mm_gasless_input");
    return rows.find(entry => entry.row.token === token) ?? mmFail("mm_gasless_unsupported_chain");
}
/** The tokens a chain's rows name, in registry order. */
export function mmChainTokens(chainId) { return rowsOf(chainId).map(entry => entry.row.token); }
/** Network, finality tag and protocol pins: the same in every row of the chain, so no token is needed for them. */
export function mmChainFacts(chainId) { return chainFacts(rowsOf(chainId)[0].row); }
/**
 * The row a prepared request uses. Its token is present exactly on a chain with several tokens, so each transfer has
 * one canonical request shape and one request hash.
 */
export function mmRequestDeployment(request) {
    if ((rowsOf(request.chainId).length > 1) !== (request.token !== undefined))
        mmFail("mm_gasless_input");
    return mmRegistry(request.chainId, request.token);
}
/**
 * The request token field for an owner's optional asset: required on a chain with several tokens; on a chain with one,
 * the asset may only name that token and the request keeps no token field.
 */
export function mmRequestToken(chainId, asset) {
    const rows = rowsOf(chainId);
    if (rows.length === 1) {
        if (asset !== undefined && asset !== rows[0].row.token)
            mmFail("mm_gasless_unsupported_chain");
        return {};
    }
    if (asset === undefined) {
        const admitted = rows.map(entry => `${MM_TOKEN_SYMBOLS[entry.row.token]} ${entry.row.token}`).join(" or ");
        throw new ApnError(MM_REASON_CODES.mm_gasless_input, `MetaMask gasless on eip155:${chainId} moves one of several tokens; name it ` +
            `with --asset set to its exact contract (${admitted}).`, { reason: "mm_gasless_input", chain_id: chainId,
            admitted_assets: rows.map(entry => entry.row.token) });
    }
    return { token: mmRegistry(chainId, asset).row.token };
}
/**
 * The row a saved record is observed against. A chain with one row keeps the earlier rule: that row, with the record's
 * own token and pins laid over it (recorded.ts). On a chain with several, the record's own token's row.
 */
export function mmRecordRegistry(chainId, token) {
    const rows = rowsOf(chainId);
    return rows.length === 1 ? rows[0] : rows.find(entry => entry.row.token === token) ?? mmFail("mm_gasless_state_corrupt");
}
/** A lane token's symbol; a token no row has named is refused, never guessed. */
export function mmTokenSymbol(token) {
    return Object.hasOwn(MM_TOKEN_SYMBOLS, token) ? MM_TOKEN_SYMBOLS[token] : mmFail("mm_gasless_state_corrupt");
}
//# sourceMappingURL=registry.js.map