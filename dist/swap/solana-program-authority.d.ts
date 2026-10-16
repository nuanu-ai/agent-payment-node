export declare const UPGRADEABLE_LOADER: "BPFLoaderUpgradeab1e11111111111111111111111";
export declare const BPF_LOADER_2: "BPFLoader2111111111111111111111111111111111";
export declare const NATIVE_LOADER: "NativeLoader1111111111111111111111111111111";
/** Loader-v3 ProgramData header: u32 variant 3, u64 deployment slot, Option<Pubkey> upgrade authority. */
export declare const PROGRAMDATA_HEADER_BYTES = 45;
/** One `dataSlice` for every program key: a whole Program account (36 bytes), a ProgramData header, a native name. */
export declare const PROGRAM_HEADER_SLICE: Readonly<{
    offset: 0;
    length: 45;
}>;
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
    readonly role: string;
    readonly programId: string;
    readonly loader: typeof UPGRADEABLE_LOADER;
    readonly programDataAddress: string;
    readonly upgradeAuthority: string | null;
}
export interface SolanaImmutableProgramAuthority {
    readonly role: string;
    readonly programId: string;
    readonly loader: typeof BPF_LOADER_2 | typeof NATIVE_LOADER;
}
/** An account as read with PROGRAM_HEADER_SLICE: `data` holds at most the first 45 bytes. */
export interface SolanaProgramAccountView {
    readonly owner: string;
    readonly executable: boolean;
    readonly data: Uint8Array;
}
/** What one read proved. The deployment slot is evidence only; it never decides acceptance. */
export interface SolanaProgramObservation {
    readonly role: string;
    readonly programId: string;
    readonly loader: string;
    readonly programDataAddress: string | null;
    readonly deploymentSlot: string | null;
    readonly upgradeAuthority: string | null;
    readonly accountSha256: string;
    readonly programDataHeaderSha256: string | null;
}
/** Every key one header read must cover: each program id, then each pinned ProgramData address. */
export declare function programAuthorityReadKeys(pins: readonly SolanaProgramAuthority[]): readonly string[];
export declare function verifyProgramAuthority(pin: SolanaProgramAuthority, program: SolanaProgramAccountView | null, programData: SolanaProgramAccountView | null): SolanaProgramObservation;
/** Verifies every pin against one map of header reads keyed by address; a missing key is a missing account. */
export declare function verifyProgramAuthorities(pins: readonly SolanaProgramAuthority[], read: (address: string) => SolanaProgramAccountView | null): readonly SolanaProgramObservation[];
