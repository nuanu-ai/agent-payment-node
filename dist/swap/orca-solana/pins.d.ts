import type { SolanaRpcPort } from "../../solana/rpc.js";
import { type SwapMechanismPin } from "../pin.js";
import { type SwapProtocolRegistry } from "../protocol-registry.js";
import { type SolanaProgramAuthority, type SolanaProgramObservation } from "../solana-program-authority.js";
/**
 * Keyless Orca Whirlpool pins. Every value was read from Solana mainnet on 2026-09-18 (slots 447989559-447990764):
 * the Whirlpool program is executable under the upgradeable loader, the pool account is owned by it, its mints are
 * wSOL (A) and USDC (B), and it is the deepest SOL/USDC Whirlpool (91,742 SOL and 15.1M USDC in its vaults, in-range
 * liquidity about 1000x the next tick spacing). It is a static-fee-tier pool (fee tier index seed = tick spacing, part of
 * its address), so it has no adaptive-fee oracle; its fee rate is read from the pool account at every quote.
 */
export declare const ORCA_SOLANA_CHAIN: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
export declare const WHIRLPOOL_PROGRAM: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
export declare const WHIRLPOOL_PROGRAMDATA: "CtXfPzz36dH5Ws4UYKZvrQ1Xqzn42ecDW6y8NKuiN8nD";
export declare const WHIRLPOOLS_CONFIG: "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ";
export declare const ORCA_SOL_USDC_POOL: "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE";
export declare const ORCA_SOL_VAULT: "EUuUbDcafPrmVTD5M6qoJAoyyNbihBhugADAxRMn5he9";
export declare const ORCA_USDC_VAULT: "2WLWEuKDgkDUccTpbwYp1GToYktiSB1cXvreHUwiSUVP";
export declare const ORCA_POOL_TICK_SPACING = 4;
export declare const WSOL_MINT: "So11111111111111111111111111111111111111112";
export declare const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export declare const SYSTEM_PROGRAM: "11111111111111111111111111111111";
export declare const TOKEN_PROGRAM: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export declare const TOKEN_PROGRAMDATA: "3gvYRKWyXRR9xKWe1ZjPhLY5ZJRN7KDB4rFZFGoJfFk2";
export declare const ATA_PROGRAM: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export declare const COMPUTE_BUDGET_PROGRAM: "ComputeBudget111111111111111111111111111111";
/** Anchor discriminators: sha256("global:swap")[0..8], sha256("account:Whirlpool"|"account:TickArray")[0..8]. */
export declare const WHIRLPOOL_SWAP_DISCRIMINATOR: "f8c69e91e17587c8";
export declare const WHIRLPOOL_ACCOUNT_DISCRIMINATOR: "3f95d10ce1806309";
export declare const TICK_ARRAY_ACCOUNT_DISCRIMINATOR: "4561bdbe6e0742bb";
/**
 * Program pins (owner decision, phase 2): the program id, its ProgramData address and its upgrade authority, never the
 * executable bytes. Orca's upgrade authority is the Squads v4 vault GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV; it
 * deployed slot 440170207 and slot 457152296 (2026-10-15, transaction 2Z156jvt…). SPL Token's authority was removed, so
 * its bytes can never change; the ATA program sits under BPFLoader2 and System and Compute Budget are native, so none of
 * them can be upgraded. A routine Whirlpool upgrade by the same authority is accepted; a different authority refuses.
 * One 45-byte header read of every program replaces the former 10 MiB programdata download.
 */
export declare const WHIRLPOOL_UPGRADE_AUTHORITY: "GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV";
export declare const ORCA_PROGRAM_AUTHORITIES: readonly SolanaProgramAuthority[];
/** Historical generation (deployed at slot 440170207). It only identifies existing operations; it cannot quote or sign. */
export declare const ORCA_KEYLESS_MECHANISM_PIN_SLOT_440170207: SwapMechanismPin;
/** Historical generation pinned to the executable bytes deployed at slot 457152296 (APN 0.5.41 and 0.5.42). Existing operations only. */
export declare const ORCA_KEYLESS_MECHANISM_PIN_SLOT_457152296: SwapMechanismPin;
/**
 * Current identity: the same route, accepted for any deployment by the pinned upgrade authority. It names no slot and no
 * bytes, so a routine Whirlpool upgrade never changes it. Owners admit the route (apn.swap-route.v1), which every
 * generation shares, so no re-admission follows.
 */
export declare const ORCA_KEYLESS_MECHANISM_PIN: SwapMechanismPin;
/** Official identity only. Owners must still admit SOL and USDC with this route under a sealed policy. */
export declare const ORCA_KEYLESS_PROTOCOL_REGISTRY: SwapProtocolRegistry;
/** Any registered keyless generation: existing operations stay readable and observable after a program upgrade. */
export declare function isOrcaKeylessMechanismDigest(digest: string): boolean;
/** Verifies every program the transaction may invoke, at quote time and again before signing. A changed authority refuses. */
export type OrcaProgramPinVerifier = (rpc: SolanaRpcPort) => Promise<readonly SolanaProgramObservation[]>;
/** One `getMultipleAccounts` of seven 45-byte slices: each Program account and the two ProgramData headers. */
export declare const verifyOrcaProgramPins: OrcaProgramPinVerifier;
export declare function sha256Hex(bytes: Uint8Array): string;
