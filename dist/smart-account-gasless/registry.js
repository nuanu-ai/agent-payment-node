import { hashDomain, keccak256 } from "viem";
import { hashObject, sha256 } from "../canonical.js";
import { SA_CHAIN_ID, SA_PROTOCOL_NAMES } from "./model.js";
import { saFail } from "./reasons.js";
import { SA_BASE_PROTOCOL, SA_BASE_TOKEN, SA_EVIDENCE_SOURCES, SA_FACILITATOR_URL, SA_FACILITATORS } from "./registry-data.js";
function freeze(value) {
    if (value !== null && typeof value === "object") {
        for (const child of Object.values(value))
            freeze(child);
        Object.freeze(value);
    }
    return value;
}
const row = {
    chainId: SA_CHAIN_ID, rpcEnv: "APN_BASE_RPC_URL", token: SA_BASE_TOKEN, protocol: SA_BASE_PROTOCOL,
    ownerDesignationCode: `0xef0100${SA_BASE_PROTOCOL.delegate.address.slice(2)}`,
    ownerDesignationCodeHash: keccak256(`0xef0100${SA_BASE_PROTOCOL.delegate.address.slice(2)}`),
    facilitatorUrl: SA_FACILITATOR_URL, facilitatorOrigin: new URL(SA_FACILITATOR_URL).origin,
    facilitatorEndpointHash: sha256(SA_FACILITATOR_URL), facilitatorAddresses: SA_FACILITATORS,
};
if (Object.keys(row.protocol).length !== SA_PROTOCOL_NAMES.length ||
    new Set(Object.values(row.protocol).map(p => p.address)).size !== SA_PROTOCOL_NAMES.length ||
    hashDomain({ domain: { name: row.token.name, version: row.token.version, chainId: BigInt(SA_CHAIN_ID),
            verifyingContract: row.token.address }, types: { EIP712Domain: [{ name: "name", type: "string" },
                { name: "version", type: "string" }, { name: "chainId", type: "uint256" },
                { name: "verifyingContract", type: "address" }] } }) !== row.token.domainSeparator)
    saFail("sa_gasless_state_corrupt");
const deployment = freeze({ ...row,
    evidenceHash: hashObject({ purpose: "apn.smart-account.gasless.deployment.v1", sources: SA_EVIDENCE_SOURCES, row }) });
/** Inventory elsewhere does not admit any executable chain or replace its own grant. */
export function saRegistry(chainId) {
    if (chainId !== SA_CHAIN_ID)
        saFail("sa_gasless_capability");
    return deployment;
}
//# sourceMappingURL=registry.js.map