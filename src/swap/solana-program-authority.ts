import { createHash } from "node:crypto";
import { getAddressDecoder } from "@solana/kit";
import { ApnError } from "../errors.js";

export const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111" as const;
export const BPF_LOADER_2 = "BPFLoader2111111111111111111111111111111111" as const;
export const NATIVE_LOADER = "NativeLoader1111111111111111111111111111111" as const;
/** Loader-v3 ProgramData header: u32 variant 3, u64 deployment slot, Option<Pubkey> upgrade authority. */
export const PROGRAMDATA_HEADER_BYTES = 45;
/** One `dataSlice` for every program key: a whole Program account (36 bytes), a ProgramData header, a native name. */
export const PROGRAM_HEADER_SLICE = Object.freeze({ offset: 0, length: PROGRAMDATA_HEADER_BYTES });

/**
 * What APN pins about a Solana program a swap invokes (owner decision, phase 2): never its executable bytes.
 * - An upgradeable program pins its id, its ProgramData address and its upgrade authority (null: the authority was
 *   removed, so the program can never change). A different authority refuses; a new deployment slot alone, a routine
 *   upgrade by the same authority, is accepted.
 * - A program owned by BPFLoader2 or the native loader cannot be upgraded at all; its loader is the pin.
 * Financial safety rests on the exact-message simulation against the programs as deployed now, the exact account and
 * privilege binding, the minimum output encoded in the instruction and the finalized receipt delta checks.
 */
export type SolanaProgramAuthority = SolanaUpgradeableProgramAuthority | SolanaImmutableProgramAuthority;
export interface SolanaUpgradeableProgramAuthority {
  readonly role: string; readonly programId: string; readonly loader: typeof UPGRADEABLE_LOADER;
  readonly programDataAddress: string; readonly upgradeAuthority: string | null;
}
export interface SolanaImmutableProgramAuthority {
  readonly role: string; readonly programId: string; readonly loader: typeof BPF_LOADER_2 | typeof NATIVE_LOADER;
}
/** An account as read with PROGRAM_HEADER_SLICE: `data` holds at most the first 45 bytes. */
export interface SolanaProgramAccountView { readonly owner: string; readonly executable: boolean; readonly data: Uint8Array }
/** What one read proved. The deployment slot is evidence only; it never decides acceptance. */
export interface SolanaProgramObservation {
  readonly role: string; readonly programId: string; readonly loader: string; readonly programDataAddress: string | null;
  readonly deploymentSlot: string | null; readonly upgradeAuthority: string | null;
  readonly accountSha256: string; readonly programDataHeaderSha256: string | null;
}

/** Every key one header read must cover: each program id, then each pinned ProgramData address. */
export function programAuthorityReadKeys(pins: readonly SolanaProgramAuthority[]): readonly string[] {
  return [...new Set([...pins.map((pin) => pin.programId),
    ...pins.flatMap((pin) => pin.loader === UPGRADEABLE_LOADER ? [pin.programDataAddress] : [])])];
}

export function verifyProgramAuthority(pin: SolanaProgramAuthority, program: SolanaProgramAccountView | null,
  programData: SolanaProgramAccountView | null): SolanaProgramObservation {
  if (program === null || program.owner !== pin.loader || !program.executable) changed(pin, "loader or executable flag");
  const account = Buffer.from(program.data);
  if (pin.loader !== UPGRADEABLE_LOADER) {
    return Object.freeze({ role: pin.role, programId: pin.programId, loader: pin.loader, programDataAddress: null, deploymentSlot: null,
      upgradeAuthority: null, accountSha256: sha256Hex(account), programDataHeaderSha256: null });
  }
  if (account.length !== 36 || account.readUInt32LE(0) !== 2 || getAddressDecoder().decode(account.subarray(4, 36)) !== pin.programDataAddress) {
    changed(pin, "ProgramData address");
  }
  const header = programData === null ? null : Buffer.from(programData.data);
  if (programData === null || header === null || programData.owner !== UPGRADEABLE_LOADER || programData.executable ||
      header.length !== PROGRAMDATA_HEADER_BYTES || header.readUInt32LE(0) !== 3 || (header[12] !== 0 && header[12] !== 1)) {
    changed(pin, "ProgramData header");
  }
  const authority = header[12] === 1 ? getAddressDecoder().decode(header.subarray(13, 45)) : null;
  if (authority !== pin.upgradeAuthority) {
    throw new ApnError("APN_OPERATION_BLOCKED", `The upgrade authority of the pinned ${pin.role} changed. An upgrade by another ` +
      "authority is not reviewed; nothing was signed. Only an APN release that reviews the new authority can use this route.",
    { reason: "solana_program_authority_changed", role: pin.role, programId: pin.programId,
      pinnedUpgradeAuthority: pin.upgradeAuthority ?? "none", observedUpgradeAuthority: authority ?? "none" });
  }
  return Object.freeze({ role: pin.role, programId: pin.programId, loader: pin.loader, programDataAddress: pin.programDataAddress,
    deploymentSlot: header.readBigUInt64LE(4).toString(), upgradeAuthority: authority, accountSha256: sha256Hex(account),
    programDataHeaderSha256: sha256Hex(header) });
}

/** Verifies every pin against one map of header reads keyed by address; a missing key is a missing account. */
export function verifyProgramAuthorities(pins: readonly SolanaProgramAuthority[],
  read: (address: string) => SolanaProgramAccountView | null): readonly SolanaProgramObservation[] {
  return Object.freeze(pins.map((pin) => verifyProgramAuthority(pin, read(pin.programId),
    pin.loader === UPGRADEABLE_LOADER ? read(pin.programDataAddress) : null)));
}

function changed(pin: SolanaProgramAuthority, what: string): never {
  throw new ApnError("APN_OPERATION_BLOCKED", `The pinned ${pin.role} ${what} changed, or the RPC returned another account; ` +
    "nothing was signed. Only an APN release that reviews the new program can use this route.",
  { reason: "solana_program_identity_changed", role: pin.role, programId: pin.programId });
}
function sha256Hex(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
