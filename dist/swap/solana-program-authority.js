import { createHash } from "node:crypto";
import { getAddressDecoder } from "@solana/kit";
import { ApnError } from "../errors.js";
export const UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
export const BPF_LOADER_2 = "BPFLoader2111111111111111111111111111111111";
export const NATIVE_LOADER = "NativeLoader1111111111111111111111111111111";
/** Loader-v3 ProgramData header: u32 variant 3, u64 deployment slot, Option<Pubkey> upgrade authority. */
export const PROGRAMDATA_HEADER_BYTES = 45;
/** One `dataSlice` for every program key: a whole Program account (36 bytes), a ProgramData header, a native name. */
export const PROGRAM_HEADER_SLICE = Object.freeze({ offset: 0, length: PROGRAMDATA_HEADER_BYTES });
/** Every key one header read must cover: each program id, then each pinned ProgramData address. */
export function programAuthorityReadKeys(pins) {
    return [...new Set([...pins.map((pin) => pin.programId),
            ...pins.flatMap((pin) => pin.loader === UPGRADEABLE_LOADER ? [pin.programDataAddress] : [])])];
}
export function verifyProgramAuthority(pin, program, programData) {
    if (program === null || program.owner !== pin.loader || !program.executable)
        changed(pin, "loader or executable flag");
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
            "authority is not reviewed; nothing was signed. Only an APN release that reviews the new authority can use this route.", { reason: "solana_program_authority_changed", role: pin.role, programId: pin.programId,
            pinnedUpgradeAuthority: pin.upgradeAuthority ?? "none", observedUpgradeAuthority: authority ?? "none" });
    }
    return Object.freeze({ role: pin.role, programId: pin.programId, loader: pin.loader, programDataAddress: pin.programDataAddress,
        deploymentSlot: header.readBigUInt64LE(4).toString(), upgradeAuthority: authority, accountSha256: sha256Hex(account),
        programDataHeaderSha256: sha256Hex(header) });
}
/** Verifies every pin against one map of header reads keyed by address; a missing key is a missing account. */
export function verifyProgramAuthorities(pins, read) {
    return Object.freeze(pins.map((pin) => verifyProgramAuthority(pin, read(pin.programId), pin.loader === UPGRADEABLE_LOADER ? read(pin.programDataAddress) : null)));
}
function changed(pin, what) {
    throw new ApnError("APN_OPERATION_BLOCKED", `The pinned ${pin.role} ${what} changed, or the RPC returned another account; ` +
        "nothing was signed. Only an APN release that reviews the new program can use this route.", { reason: "solana_program_identity_changed", role: pin.role, programId: pin.programId });
}
function sha256Hex(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
//# sourceMappingURL=solana-program-authority.js.map