import { getAddress } from "viem";
import { ApnError } from "../errors.js";
/**
 * Local-wallet gasless USDT on Ethereum through Pimlico's ERC-20 paymaster, reached through the keyless public endpoint.
 * Every identity below was read from Ethereum mainnet on 2026-09-18 (block 26002950) and is exposed as a read-only capability registry; this foundation performs no effect.
 * The sponsor charges its fee in the same token, in postOp, from the sender to the pinned treasury.
 */
export const USDT_GASLESS = Object.freeze({
    chainId: 1,
    chain: "eip155:1",
    network: "Ethereum",
    rpcEnv: "APN_ETHEREUM_RPC_URL",
    bundlerEnv: "APN_ETHEREUM_BUNDLER_RPC_URL",
    /** Public, keyless: no API key, 20 requests per minute per IP shared with every other call. */
    bundlerUrl: "https://public.pimlico.io/v2/1/rpc",
    token: getAddress("0xdAC17F958D2ee523a2206206994597C13D831ec7"),
    symbol: "USDT",
    decimals: 6,
    tokenCodeHash: "0xb44fb4e949d0f78f87f79ee46428f23a2a5713ce6fc6e0beb3dda78c2ac1ea55",
    /** USDT storage the quote names: `balances` at slot 2 and `allowed` at slot 5. */
    balanceSlot: 2n,
    allowanceSlot: 5n,
    entryPoint: getAddress("0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108"),
    entryPointCodeHash: "0x44e632a24c6f2600cbd5b5b8b4c2d372359112c8b5774297f5fd0a9e64f11f86",
    delegate: getAddress("0xe6Cae83BdE06E4c305530e199D7217f42808555B"),
    delegateCodeHash: "0xcc7b633aef4b2543cb8f37522adf1a401f910f0f6b2430c1eecc11f401ccfcf3",
    /** Pimlico singleton ERC-20 paymaster for EntryPoint v0.8; not a proxy. */
    paymaster: getAddress("0x888888888888Ec68A58AB8094Cc1AD20Ba3D2402"),
    paymasterCodeHash: "0xd90bf4b662c7e3134b65065c5a1dc96e5be152aff8b6748ddc164109e8aab308",
    /** Fee recipient named inside every signed paymaster payload. A different treasury fails closed. */
    treasury: getAddress("0x4337Ff05c84B9A80Ea0a78dBE7B8E102F66d4c08"),
    /** The owner allowlist pin an admission on rail `gasless` must carry, field for field. */
    mechanism: Object.freeze({ provider: "pimlico-erc20-paymaster", reference: "eip155:1:0x888888888888Ec68A58AB8094Cc1AD20Ba3D2402" }),
});
/**
 * Fixed gas offer for the three-call batch (approve 0, approve fee cap, transfer). The fee bound multiplies every field by
 * the price, so the owner's cap covers the worst case; the bundler cannot use more than these limits.
 */
export const USDT_GASLESS_GAS = Object.freeze({
    verificationGasLimit: 75000n,
    callGasLimit: 130000n,
    paymasterVerificationGasLimit: 100000n,
    paymasterPostOpGasLimit: 75000n,
    preVerificationGas: 100000n,
});
/** Bounds the provider quote must stay inside; anything outside refuses instead of being clamped. */
export const USDT_POST_OP_GAS_MAX = 100000n;
export const USDT_EXCHANGE_RATE_MAX = 1n << 128n;
/** A sponsor payload must be valid for at least this long and at most this long after the check. */
export const USDT_PAYMASTER_MIN_VALIDITY_S = 60n;
export const USDT_PAYMASTER_MAX_VALIDITY_S = 3600n;
export function usdtFailure(code, reason, message = `Gasless USDT refused: ${reason}.`) {
    throw new ApnError(code, message, { reason, rail: "gasless" });
}
//# sourceMappingURL=model.js.map