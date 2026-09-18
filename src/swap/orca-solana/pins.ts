import { createHash } from "node:crypto";
import { address, getAddressEncoder } from "@solana/kit";
import { SOLANA_USDC } from "../../chain-policy.js";
import { ApnError } from "../../errors.js";
import type { SolanaRpcPort } from "../../solana/rpc.js";
import { SWAP_MECHANISM_PIN_SCHEMA, validateSwapMechanismPin, type SwapMechanismPin } from "../pin.js";
import { compileSwapProtocolRegistry, type SwapProtocolRegistry } from "../protocol-registry.js";
import { readRawAccounts, type RawSolanaAccount } from "./accounts.js";

/**
 * Keyless Orca Whirlpool pins. Every value was read from Solana mainnet on 2026-09-18 (slots 447989559-447990764):
 * the Whirlpool program is executable under the upgradeable loader, the pool account is owned by it, its mints are
 * wSOL (A) and USDC (B), and it is the deepest SOL/USDC Whirlpool (91,742 SOL and 15.1M USDC in its vaults, in-range
 * liquidity about 1000x the next tick spacing). Its oracle PDA is absent, so the fee is the static fee rate below.
 */
export const ORCA_SOLANA_CHAIN = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" as const;
export const WHIRLPOOL_PROGRAM = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc" as const;
export const WHIRLPOOL_PROGRAMDATA = "CtXfPzz36dH5Ws4UYKZvrQ1Xqzn42ecDW6y8NKuiN8nD" as const;
export const WHIRLPOOLS_CONFIG = "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ" as const;
export const ORCA_SOL_USDC_POOL = "Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE" as const;
export const ORCA_SOL_VAULT = "EUuUbDcafPrmVTD5M6qoJAoyyNbihBhugADAxRMn5he9" as const;
export const ORCA_USDC_VAULT = "2WLWEuKDgkDUccTpbwYp1GToYktiSB1cXvreHUwiSUVP" as const;
export const ORCA_POOL_TICK_SPACING = 4;
/** Hundredths of a basis point (400 = 0.04%). A fee change is a pin drift and refuses until re-reviewed. */
export const ORCA_POOL_FEE_RATE = 400;
export const WSOL_MINT = "So11111111111111111111111111111111111111112" as const;
export const USDC_MINT = SOLANA_USDC;
export const SYSTEM_PROGRAM = "11111111111111111111111111111111" as const;
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as const;
export const TOKEN_PROGRAMDATA = "3gvYRKWyXRR9xKWe1ZjPhLY5ZJRN7KDB4rFZFGoJfFk2" as const;
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" as const;
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111" as const;
export const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111" as const;
export const IMMUTABLE_LOADER = "BPFLoader2111111111111111111111111111111111" as const;
export const NATIVE_LOADER = "NativeLoader1111111111111111111111111111111" as const;
/** Anchor discriminators: sha256("global:swap")[0..8], sha256("account:Whirlpool"|"account:TickArray")[0..8]. */
export const WHIRLPOOL_SWAP_DISCRIMINATOR = "f8c69e91e17587c8" as const;
export const WHIRLPOOL_ACCOUNT_DISCRIMINATOR = "3f95d10ce1806309" as const;
export const TICK_ARRAY_ACCOUNT_DISCRIMINATOR = "4561bdbe6e0742bb" as const;

/**
 * Program byte pins. Upgradeable programs pin their programdata: Whirlpool (10 MiB, upgrade authority
 * GwH3Hiv5mACLX3ufTw1pFsrhSPon5tdw252DBs4Rx4PV, deployed at slot 440170207) pins the SHA-256 of its 45-byte header,
 * which changes on every upgrade; its full programdata SHA-256 at pin time was
 * b5ee20ce8a99d4f111e408b4a6e610accb9637089a568db116de9e4658048fa0. SPL Token's programdata has no upgrade authority
 * and is pinned in full, as is the immutable BPFLoader2 ATA program. Native programs pin their loader name bytes.
 */
export interface OrcaProgramPin {
  readonly role: string; readonly address: string; readonly owner: string; readonly executable: boolean;
  readonly space: number; readonly dataSha256: string; readonly headerOnly: boolean;
}
export const ORCA_PROGRAM_PINS: readonly OrcaProgramPin[] = [
  { role: "whirlpool_program", address: WHIRLPOOL_PROGRAM, owner: UPGRADEABLE_LOADER, executable: true, space: 36, headerOnly: false,
    dataSha256: programAccountHash(WHIRLPOOL_PROGRAMDATA) },
  { role: "whirlpool_programdata_header", address: WHIRLPOOL_PROGRAMDATA, owner: UPGRADEABLE_LOADER, executable: false, space: 10_485_760,
    headerOnly: true, dataSha256: "88fc1d0d634f1afa667a1a429b87bbb3217d3a56e3094dedbd7d695224ee1814" },
  { role: "spl_token_program", address: TOKEN_PROGRAM, owner: UPGRADEABLE_LOADER, executable: true, space: 36, headerOnly: false,
    dataSha256: programAccountHash(TOKEN_PROGRAMDATA) },
  { role: "spl_token_programdata", address: TOKEN_PROGRAMDATA, owner: UPGRADEABLE_LOADER, executable: false, space: 108_645, headerOnly: false,
    dataSha256: "573971c9baedda479bf4c38537787ae396358009b4920f8a270bd2b31dde5fe3" },
  { role: "associated_token_program", address: ATA_PROGRAM, owner: IMMUTABLE_LOADER, executable: true, space: 105_032, headerOnly: false,
    dataSha256: "6804554e69fd3a58caa191dc4a58f4c67223d30ca28ab8987f39fc18d2f7374d" },
  { role: "system_program", address: SYSTEM_PROGRAM, owner: NATIVE_LOADER, executable: true, space: 21, headerOnly: false,
    dataSha256: sha256Hex(Buffer.from("solana_system_program")) },
  { role: "compute_budget_program", address: COMPUTE_BUDGET_PROGRAM, owner: NATIVE_LOADER, executable: true, space: 22, headerOnly: false,
    dataSha256: sha256Hex(Buffer.from("compute_budget_program")) },
];
export const PROGRAMDATA_HEADER_BYTES = 45;

export const ORCA_KEYLESS_MECHANISM_PIN: SwapMechanismPin = validateSwapMechanismPin({
  schemaVersion: SWAP_MECHANISM_PIN_SCHEMA, protocolFamily: "orca_solana", networkFamily: "solana", chain: ORCA_SOLANA_CHAIN,
  protocolVersion: "whirlpool-slot-440170207", constructorKind: "sdk", constructorIdentity: "apn.orca-whirlpool.local-instruction-builder",
  constructorVersion: "1.0.0", routerProgramIdentity: WHIRLPOOL_PROGRAM,
  auxiliaryContractProgramIdentities: [ORCA_SOL_USDC_POOL, WHIRLPOOLS_CONFIG, TOKEN_PROGRAM, ATA_PROGRAM, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM],
  quoteSchemaVersion: "whirlpool-onchain-state.exact-in-a-to-b.1",
  transactionSchemaVersion: "v0.compute-budget-ata-wrap-swap-close.1",
  validationPolicyIdentity: "apn.orca.solana-native-sol-usdc-keyless", validationPolicyVersion: "1.0.0",
});
/** Official identity only. Owners must still admit SOL and USDC with this exact pin under a sealed policy. */
export const ORCA_KEYLESS_PROTOCOL_REGISTRY: SwapProtocolRegistry = compileSwapProtocolRegistry({
  registryVersion: "orca-whirlpool-keyless.2026-09-18", pins: [ORCA_KEYLESS_MECHANISM_PIN],
});

/** Verifies every program the transaction may invoke, at quote time and again before signing. Drift fails closed. */
export type OrcaProgramPinVerifier = (rpc: SolanaRpcPort) => Promise<readonly OrcaProgramPin[]>;

export const verifyOrcaProgramPins: OrcaProgramPinVerifier = async (rpc) => {
  const full = ORCA_PROGRAM_PINS.filter((pin) => !pin.headerOnly), header = ORCA_PROGRAM_PINS.filter((pin) => pin.headerOnly);
  const fullRead = await readRawAccounts(rpc, full.map((pin) => pin.address), 262_144);
  const headerRead = await readRawAccounts(rpc, header.map((pin) => pin.address), PROGRAMDATA_HEADER_BYTES,
    { offset: 0, length: PROGRAMDATA_HEADER_BYTES });
  full.forEach((pin, index) => verifyProgram(pin, fullRead.accounts[index] ?? null));
  header.forEach((pin, index) => verifyProgram(pin, headerRead.accounts[index] ?? null));
  return ORCA_PROGRAM_PINS;
};

function verifyProgram(pin: OrcaProgramPin, account: RawSolanaAccount | null): void {
  if (account === null || account.owner !== pin.owner || account.executable !== pin.executable || account.space !== pin.space ||
      sha256Hex(account.data) !== pin.dataSha256 || (!pin.headerOnly && account.data.length !== pin.space)) {
    throw new ApnError("APN_OPERATION_BLOCKED", `Pinned ${pin.role} bytes, loader, or executable flag changed.`, { reason: "orca_program_pin_drift" });
  }
}
function programAccountHash(programdata: string): string {
  return sha256Hex(Buffer.concat([Buffer.from([2, 0, 0, 0]), Buffer.from(getAddressEncoder().encode(address(programdata)))]));
}
export function sha256Hex(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
