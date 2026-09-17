import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { getAddress } from "viem";
import { address as solanaAddress } from "@solana/kit";
import { tronAddress } from "../tron/codec.js";
export const SWAP_MECHANISM_PIN_SCHEMA = "apn.swap-mechanism-pin.v1";
const TEXT = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,255}$/u;
const VERSION = /^(?=[A-Za-z0-9._+-]{1,64}$)(?=.*[0-9])[A-Za-z0-9][A-Za-z0-9._+-]*$/u;
const EXPECTED = {
    uniswap_ethereum: { family: "evm", chain: "eip155:1" },
    sunswap_tron: { family: "tron", chain: "tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc" },
    jupiter_solana: { family: "solana", chain: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" },
};
export function validateSwapMechanismPin(value) {
    if (!isPlainRecord(value) || !exactKeys(value, [
        "schemaVersion", "protocolFamily", "networkFamily", "chain", "protocolVersion", "constructorKind",
        "constructorIdentity", "constructorVersion", "routerProgramIdentity", "auxiliaryContractProgramIdentities",
        "quoteSchemaVersion", "transactionSchemaVersion", "validationPolicyIdentity", "validationPolicyVersion",
    ]) || value.schemaVersion !== SWAP_MECHANISM_PIN_SCHEMA ||
        (value.protocolFamily !== "uniswap_ethereum" && value.protocolFamily !== "sunswap_tron" && value.protocolFamily !== "jupiter_solana") ||
        (value.networkFamily !== "evm" && value.networkFamily !== "tron" && value.networkFamily !== "solana") ||
        (value.constructorKind !== "builder_api" && value.constructorKind !== "sdk") ||
        typeof value.chain !== "string" || typeof value.protocolVersion !== "string" ||
        typeof value.constructorIdentity !== "string" || typeof value.constructorVersion !== "string" ||
        typeof value.routerProgramIdentity !== "string" || typeof value.quoteSchemaVersion !== "string" ||
        typeof value.transactionSchemaVersion !== "string" || typeof value.validationPolicyIdentity !== "string" ||
        typeof value.validationPolicyVersion !== "string" || !Array.isArray(value.auxiliaryContractProgramIdentities) ||
        value.auxiliaryContractProgramIdentities.length > 16 || !TEXT.test(value.constructorIdentity) ||
        !VERSION.test(value.protocolVersion) ||
        !VERSION.test(value.constructorVersion) || !VERSION.test(value.quoteSchemaVersion) ||
        !VERSION.test(value.transactionSchemaVersion) || !TEXT.test(value.validationPolicyIdentity) ||
        !VERSION.test(value.validationPolicyVersion) || value.auxiliaryContractProgramIdentities.some((item) => typeof item !== "string") ||
        new Set([value.routerProgramIdentity, ...value.auxiliaryContractProgramIdentities]).size !==
            value.auxiliaryContractProgramIdentities.length + 1)
        invalid("Swap mechanism pin is malformed, duplicate, or unversioned.");
    const expected = EXPECTED[value.protocolFamily];
    if (value.networkFamily !== expected.family || value.chain !== expected.chain) {
        invalid("Swap protocol family does not match its exact network family and chain.");
    }
    const family = value.networkFamily;
    const programs = [value.routerProgramIdentity, ...value.auxiliaryContractProgramIdentities];
    if (programs.some((identity) => canonicalProgramIdentity(family, identity) !== identity)) {
        invalid("Swap router and auxiliary program identities must be canonical for the pinned network family.");
    }
    return value;
}
export function swapMechanismDigest(value) {
    return domainHash(SWAP_MECHANISM_PIN_SCHEMA, canonicalJson(validateSwapMechanismPin(value)));
}
function invalid(message) { throw new ApnError("APN_INVALID_INPUT", message); }
function canonicalProgramIdentity(family, value) {
    try {
        if (family === "evm") {
            const result = getAddress(value);
            if (result === "0x0000000000000000000000000000000000000000")
                throw new Error();
            return result;
        }
        if (family === "solana")
            return solanaAddress(value);
        return tronAddress(value);
    }
    catch {
        return invalid("Swap router or auxiliary program identity is invalid for its network family.");
    }
}
//# sourceMappingURL=pin.js.map