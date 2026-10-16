import { createHash } from "node:crypto";
import { SOLANA_USDC } from "../../chain-policy.js";
import type { SolanaRpcPort } from "../../solana/rpc.js";
import { SWAP_MECHANISM_PIN_SCHEMA, swapMechanismDigest, validateSwapMechanismPin, type SwapMechanismPin } from "../pin.js";
import { compileSwapProtocolRegistry, type SwapProtocolRegistry } from "../protocol-registry.js";
import { BPF_LOADER_2, NATIVE_LOADER, PROGRAM_HEADER_SLICE, PROGRAMDATA_HEADER_BYTES, programAuthorityReadKeys, UPGRADEABLE_LOADER,
  verifyProgramAuthorities, type SolanaProgramAuthority, type SolanaProgramObservation } from "../solana-program-authority.js";
import { readRawAccounts } from "./accounts.js";

/**
 * Keyless Orca Whirlpool pins. Every value was read from Solana mainnet on 2026-09-18 (slots 447989559-447990764):
 * the Whirlpool program is executable under the upgradeable loader, the pool account is owned by it, its mints are
 * wSOL (A) and USDC (B), and it is the deepest SOL/USDC Whirlpool (91,742 SOL and 15.1M USDC in its vaults, in-range
 * liquidity about 1000x the next tick spacing). It is a static-fee-tier pool (fee tier index seed = tick spacing, part of
 * its address), so it has no adaptive-fee oracle; its fee rate is read from the pool account at every quote.
 */
export const ORCA_SOLANA_CHAIN = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" as const;
export const WHIRLPOOL_PROGRAM = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc" as const;
export const WHIRLPOOL_PROGRAMDATA = "CtXfPzz36dH5Ws4UYKZvrQ1Xqzn42ecDW6y8NKuiN8nD" as const;
export const WHIRLPOOLS_CONFIG = "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ" as const;
export const ORCA_SOL_USDC_POOL = "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE" as const;
export const ORCA_SOL_VAULT = "EUuUbDcafPrmVTD5M6qoJAoyyNbihBhugADAxRMn5he9" as const;
export const ORCA_USDC_VAULT = "2WLWEuKDgkDUccTpbwYp1GToYktiSB1cXvreHUwiSUVP" as const;
export const ORCA_POOL_TICK_SPACING = 4;
export const WSOL_MINT = "So11111111111111111111111111111111111111112" as const;
export const USDC_MINT = SOLANA_USDC;
export const SYSTEM_PROGRAM = "11111111111111111111111111111111" as const;
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as const;
export const TOKEN_PROGRAMDATA = "3gvYRKWyXRR9xKWe1ZjPhLY5ZJRN7KDB4rFZFGoJfFk2" as const;
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" as const;
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111" as const;
/** Anchor discriminators: sha256("global:swap")[0..8], sha256("account:Whirlpool"|"account:TickArray")[0..8]. */
export const WHIRLPOOL_SWAP_DISCRIMINATOR = "f8c69e91e17587c8" as const;
export const WHIRLPOOL_ACCOUNT_DISCRIMINATOR = "3f95d10ce1806309" as const;
export const TICK_ARRAY_ACCOUNT_DISCRIMINATOR = "4561bdbe6e0742bb" as const;

/**
 * Program pins (owner decision, phase 2): the program id, its ProgramData address and its upgrade authority, never the
 * executable bytes. Orca's upgrade authority is the Squads v4 vault GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV; it
 * deployed slot 440170207 and slot 457152296 (2026-10-15, transaction 2Z156jvt…). SPL Token's authority was removed, so
 * its bytes can never change; the ATA program sits under BPFLoader2 and System and Compute Budget are native, so none of
 * them can be upgraded. A routine Whirlpool upgrade by the same authority is accepted; a different authority refuses.
 * One 45-byte header read of every program replaces the former 10 MiB programdata download.
 */
export const WHIRLPOOL_UPGRADE_AUTHORITY = "GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV" as const;
export const ORCA_PROGRAM_AUTHORITIES: readonly SolanaProgramAuthority[] = Object.freeze([
  { role: "whirlpool_program", programId: WHIRLPOOL_PROGRAM, loader: UPGRADEABLE_LOADER, programDataAddress: WHIRLPOOL_PROGRAMDATA,
    upgradeAuthority: WHIRLPOOL_UPGRADE_AUTHORITY },
  { role: "spl_token_program", programId: TOKEN_PROGRAM, loader: UPGRADEABLE_LOADER, programDataAddress: TOKEN_PROGRAMDATA, upgradeAuthority: null },
  { role: "associated_token_program", programId: ATA_PROGRAM, loader: BPF_LOADER_2 },
  { role: "system_program", programId: SYSTEM_PROGRAM, loader: NATIVE_LOADER },
  { role: "compute_budget_program", programId: COMPUTE_BUDGET_PROGRAM, loader: NATIVE_LOADER },
].map((pin) => Object.freeze(pin)) as SolanaProgramAuthority[]);

/** Historical generation (deployed at slot 440170207). It only identifies existing operations; it cannot quote or sign. */
export const ORCA_KEYLESS_MECHANISM_PIN_SLOT_440170207: SwapMechanismPin = validateSwapMechanismPin({
  schemaVersion: SWAP_MECHANISM_PIN_SCHEMA, protocolFamily: "orca_solana", networkFamily: "solana", chain: ORCA_SOLANA_CHAIN,
  protocolVersion: "whirlpool-slot-440170207", constructorKind: "sdk", constructorIdentity: "apn.orca-whirlpool.local-instruction-builder",
  constructorVersion: "1.0.0", routerProgramIdentity: WHIRLPOOL_PROGRAM,
  auxiliaryContractProgramIdentities: [ORCA_SOL_USDC_POOL, WHIRLPOOLS_CONFIG, TOKEN_PROGRAM, ATA_PROGRAM, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM],
  quoteSchemaVersion: "whirlpool-onchain-state.exact-in-a-to-b.1",
  transactionSchemaVersion: "v0.compute-budget-ata-wrap-swap-close.1",
  validationPolicyIdentity: "apn.orca.solana-native-sol-usdc-keyless", validationPolicyVersion: "1.0.0",
});
/** Historical generation pinned to the executable bytes deployed at slot 457152296 (APN 0.5.41 and 0.5.42). Existing operations only. */
export const ORCA_KEYLESS_MECHANISM_PIN_SLOT_457152296: SwapMechanismPin = validateSwapMechanismPin({
  ...ORCA_KEYLESS_MECHANISM_PIN_SLOT_440170207, protocolVersion: "whirlpool-slot-457152296",
});
/**
 * Current identity: the same route, accepted for any deployment by the pinned upgrade authority. It names no slot and no
 * bytes, so a routine Whirlpool upgrade never changes it. Owners admit the route (apn.swap-route.v1), which every
 * generation shares, so no re-admission follows.
 */
export const ORCA_KEYLESS_MECHANISM_PIN: SwapMechanismPin = validateSwapMechanismPin({
  ...ORCA_KEYLESS_MECHANISM_PIN_SLOT_440170207, protocolVersion: "whirlpool-upgrade-authority.1", validationPolicyVersion: "2.0.0",
});
/** Official identity only. Owners must still admit SOL and USDC with this route under a sealed policy. */
export const ORCA_KEYLESS_PROTOCOL_REGISTRY: SwapProtocolRegistry = compileSwapProtocolRegistry({
  registryVersion: "orca-whirlpool-keyless.2026-10-17", pins: [ORCA_KEYLESS_MECHANISM_PIN],
});
const ORCA_KEYLESS_MECHANISM_DIGESTS: readonly string[] = Object.freeze([ORCA_KEYLESS_MECHANISM_PIN, ORCA_KEYLESS_MECHANISM_PIN_SLOT_457152296,
  ORCA_KEYLESS_MECHANISM_PIN_SLOT_440170207].map((pin) => swapMechanismDigest(pin)));
/** Any registered keyless generation: existing operations stay readable and observable after a program upgrade. */
export function isOrcaKeylessMechanismDigest(digest: string): boolean { return ORCA_KEYLESS_MECHANISM_DIGESTS.includes(digest); }

/** Verifies every program the transaction may invoke, at quote time and again before signing. A changed authority refuses. */
export type OrcaProgramPinVerifier = (rpc: SolanaRpcPort) => Promise<readonly SolanaProgramObservation[]>;

/** One `getMultipleAccounts` of seven 45-byte slices: each Program account and the two ProgramData headers. */
export const verifyOrcaProgramPins: OrcaProgramPinVerifier = async (rpc) => {
  const keys = programAuthorityReadKeys(ORCA_PROGRAM_AUTHORITIES);
  const read = await readRawAccounts(rpc, keys, PROGRAMDATA_HEADER_BYTES, PROGRAM_HEADER_SLICE);
  const accounts = new Map(keys.map((key, index) => [key, read.accounts[index] ?? null]));
  return verifyProgramAuthorities(ORCA_PROGRAM_AUTHORITIES, (address) => accounts.get(address) ?? null);
};
export function sha256Hex(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
