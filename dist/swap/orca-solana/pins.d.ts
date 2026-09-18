import type { SolanaRpcPort } from "../../solana/rpc.js";
import { type SwapMechanismPin } from "../pin.js";
import { type SwapProtocolRegistry } from "../protocol-registry.js";
/**
 * Keyless Orca Whirlpool pins. Every value was read from Solana mainnet on 2026-09-18 (slots 447989559-447990764):
 * the Whirlpool program is executable under the upgradeable loader, the pool account is owned by it, its mints are
 * wSOL (A) and USDC (B), and it is the deepest SOL/USDC Whirlpool (91,742 SOL and 15.1M USDC in its vaults, in-range
 * liquidity about 1000x the next tick spacing). Its oracle PDA is absent, so the fee is the static fee rate below.
 */
export declare const ORCA_SOLANA_CHAIN: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export declare const WHIRLPOOL_PROGRAM: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
export declare const WHIRLPOOL_PROGRAMDATA: "CtXfPzz36dH5Ws4UYKZvrQ1Xqzn42ecDW6y8NKuiN8nD";
export declare const WHIRLPOOLS_CONFIG: "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ";
export declare const ORCA_SOL_USDC_POOL: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE";
export declare const ORCA_SOL_VAULT: "EUuUbDcafPrmVTD5M6qoJAoyyNbihBhugADAxRMn5he9";
export declare const ORCA_USDC_VAULT: "2WLWEuKDgkDUccTpbwYp1GToYktiSB1cXvreHUwiSUVP";
export declare const ORCA_POOL_TICK_SPACING = 4;
/** Hundredths of a basis point (400 = 0.04%). A fee change is a pin drift and refuses until re-reviewed. */
export declare const ORCA_POOL_FEE_RATE = 400;
export declare const WSOL_MINT: "So11111111111111111111111111111111111111112";
export declare const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export declare const SYSTEM_PROGRAM: "11111111111111111111111111111111";
export declare const TOKEN_PROGRAM: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export declare const TOKEN_PROGRAMDATA: "3gvYRKWyXRR9xKWe1ZjPhLY5ZJRN7KDB4rFZFGoJfFk2";
export declare const ATA_PROGRAM: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export declare const COMPUTE_BUDGET_PROGRAM: "ComputeBudget111111111111111111111111111111";
export declare const UPGRADEABLE_LOADER: "BPFLoaderUpgradeab1e11111111111111111111111";
export declare const IMMUTABLE_LOADER: "BPFLoader2111111111111111111111111111111111";
export declare const NATIVE_LOADER: "NativeLoader1111111111111111111111111111111";
/** Anchor discriminators: sha256("global:swap")[0..8], sha256("account:Whirlpool"|"account:TickArray")[0..8]. */
export declare const WHIRLPOOL_SWAP_DISCRIMINATOR: "f8c69e91e17587c8";
export declare const WHIRLPOOL_ACCOUNT_DISCRIMINATOR: "3f95d10ce1806309";
export declare const TICK_ARRAY_ACCOUNT_DISCRIMINATOR: "4561bdbe6e0742bb";
/**
 * Program byte pins. Upgradeable programs pin their programdata: Whirlpool (10 MiB, upgrade authority
 * GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV, deployed at slot 440170207) pins the SHA-256 of its 45-byte header,
 * which changes on every upgrade; its full programdata SHA-256 at pin time was
 * b5ee20ce8a99d4f111e408b4a6e610accb9637089a568db116de9e4658048fa0. SPL Token's programdata has no upgrade authority
 * and is pinned in full, as is the immutable BPFLoader2 ATA program. Native programs pin their loader name bytes.
 */
export interface OrcaProgramPin {
    readonly role: string;
    readonly address: string;
    readonly owner: string;
    readonly executable: boolean;
    readonly space: number;
    readonly dataSha256: string;
    readonly headerOnly: boolean;
}
export declare const ORCA_PROGRAM_PINS: readonly OrcaProgramPin[];
export declare const PROGRAMDATA_HEADER_BYTES = 45;
export declare const ORCA_KEYLESS_MECHANISM_PIN: SwapMechanismPin;
/** Official identity only. Owners must still admit SOL and USDC with this exact pin under a sealed policy. */
export declare const ORCA_KEYLESS_PROTOCOL_REGISTRY: SwapProtocolRegistry;
/** Verifies every program the transaction may invoke, at quote time and again before signing. Drift fails closed. */
export type OrcaProgramPinVerifier = (rpc: SolanaRpcPort) => Promise<readonly OrcaProgramPin[]>;
export declare const verifyOrcaProgramPins: OrcaProgramPinVerifier;
export declare function sha256Hex(bytes: Uint8Array): string;
