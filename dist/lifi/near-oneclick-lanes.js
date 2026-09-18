import { getAddress } from "viem";
import { ApnError } from "../errors.js";
import { solanaAddress } from "../solana/rpc.js";
import { TRON_USDT, tronAddress } from "../tron/codec.js";
/** Pinned NEAR 1Click lanes. Asset IDs match the public 1Click token list (GET /v0/tokens, 2026-09-18). No wildcard lane exists. */
export const ONECLICK_LANE_IDS = ["base-usdc-to-tron-usdt", "ethereum-eth-to-tron-trx", "ethereum-eth-to-solana-sol",
    "ethereum-eth-to-tron-usdt"];
const BASE_USDC = { network: "base", chainId: 8453, asset: "USDC", kind: "erc20",
    token: getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"), decimals: 6,
    oneClickAsset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", rpcEnvironment: "APN_BASE_RPC_URL",
    maxAmountAtomic: 10000000000000n };
const ETHEREUM_ETH = { network: "ethereum", chainId: 1, asset: "ETH", kind: "native", token: null,
    decimals: 18, oneClickAsset: "nep141:eth.omft.near", rpcEnvironment: "APN_ETHEREUM_RPC_URL",
    maxAmountAtomic: 1000000000000000000n };
const TRON_USDT_DESTINATION = { network: "tron", asset: "USDT", kind: "trc20", token: TRON_USDT,
    decimals: 6, oneClickAsset: "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", rpcEnvironment: "APN_TRON_RPC_URL" };
const TRON_TRX = { network: "tron", asset: "TRX", kind: "native", token: null, decimals: 6,
    oneClickAsset: "nep141:tron.omft.near", rpcEnvironment: "APN_TRON_RPC_URL" };
const SOLANA_SOL = { network: "solana", asset: "SOL", kind: "native", token: null, decimals: 9,
    oneClickAsset: "nep141:sol.omft.near", rpcEnvironment: "APN_SOLANA_RPC_URL" };
export const ONECLICK_LANES = Object.freeze([
    { id: "base-usdc-to-tron-usdt", origin: BASE_USDC, destination: TRON_USDT_DESTINATION, loss: "input_at_par" },
    { id: "ethereum-eth-to-tron-trx", origin: ETHEREUM_ETH, destination: TRON_TRX, loss: "quote_rate" },
    { id: "ethereum-eth-to-solana-sol", origin: ETHEREUM_ETH, destination: SOLANA_SOL, loss: "quote_rate" },
    { id: "ethereum-eth-to-tron-usdt", origin: ETHEREUM_ETH, destination: TRON_USDT_DESTINATION, loss: "quote_rate" },
]);
/** Records written before lanes existed (schema v1/v2) were only ever this lane. */
export const LEGACY_ONECLICK_LANE = "base-usdc-to-tron-usdt";
export function oneClickLane(id) {
    const lane = ONECLICK_LANES.find(candidate => candidate.id === id);
    if (lane === undefined)
        throw new ApnError("APN_INVALID_INPUT", `Unlisted 1Click lane. Use exactly one of: ${ONECLICK_LANE_IDS.join(", ")}.`);
    return lane;
}
/** Exact canonical destination recipient: TRON base58check for TRX/USDT, a 32-byte Solana base58 key for SOL. */
export function oneClickRecipient(lane, value) {
    let canonical;
    try {
        canonical = lane.destination.network === "tron" ? tronAddress(value) : solanaAddress(value);
    }
    catch {
        canonical = undefined;
    }
    if (canonical !== value)
        throw new ApnError("APN_INVALID_INPUT", lane.destination.network === "tron"
            ? "The 1Click recipient must be a canonical TRON base58check address." : "The 1Click recipient must be a canonical 32-byte Solana base58 address.");
    return value;
}
//# sourceMappingURL=near-oneclick-lanes.js.map