import { getAddress } from "viem";
import { exactKeys, hashObject, isPlainRecord } from "../canonical.js";
import { ApnError } from "../errors.js";
import { decodeUsdtPaymasterData } from "./paymaster-data.js";
/** Each saved schema and the exact binding fields it was written with. */
const SCHEMAS = {
    "apn.gasless-usdt-bound-operation.v1": { binding: "apn.gasless-usdt-policy-prepare.v1", fields: [] },
    "apn.gasless-usdt-bound-operation.v2": { binding: "apn.gasless-usdt-policy-prepare.v2", fields: ["quoteFacts", "sponsorAuth"] },
};
const BINDING_FIELDS = ["schemaVersion", "profile", "policyDigest", "policyRevision", "activationDigest", "chain", "token", "mechanism",
    "sponsorUrl", "safeBlockNumber", "safeBlockHash", "account", "plan", "callData", "paymaster", "paymasterData", "unsignedOperation", "bindingHash"];
const HASH = /^[a-f0-9]{64}$/u, DECIMAL = /^(0|[1-9][0-9]*)$/u;
function fail(reason) {
    throw new ApnError("APN_STATE_CORRUPT", `Gasless USDT binding refused: ${reason}.`, { reason, rail: "gasless_usdt" });
}
function address(value) {
    try {
        if (typeof value !== "string" || getAddress(value) !== value)
            fail("stored_address");
    }
    catch {
        fail("stored_address");
    }
}
function decimals(values) {
    if (values.some(value => typeof value !== "string" || !DECIMAL.test(value)))
        fail("stored_decimal");
}
/**
 * R2 reader for a saved bound operation: its own integrity hashes and the field layout of the schema it was written with,
 * never the current USDT_GASLESS constants. Status, resume, observation and the release of a hold keep working for every
 * record an earlier release wrote, even after a pin, address or bound changes. Anything that signs or sends re-runs the
 * full current validation (`validateUsdtAnyBoundOperation`) first.
 */
export function validateUsdtStoredBoundOperation(value) {
    if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "profileHash", "idempotencyKey", "binding", "createdAt",
        "signerBoundary", "dispatch", "usageReservation", "integrityHash"]))
        fail("bound_shape");
    const schema = SCHEMAS[value.schemaVersion];
    if (schema === undefined || typeof value.operationId !== "string" || !HASH.test(value.operationId) ||
        typeof value.profileHash !== "string" || !HASH.test(value.profileHash) || typeof value.integrityHash !== "string" ||
        !HASH.test(value.integrityHash) || typeof value.idempotencyKey !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value.idempotencyKey) ||
        typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) ||
        new Date(value.createdAt).toISOString() !== value.createdAt)
        fail("bound_identity");
    const b = value.binding;
    if (!isPlainRecord(b) || !exactKeys(b, [...BINDING_FIELDS, ...schema.fields]) || b.schemaVersion !== schema.binding ||
        typeof b.profile !== "string" || b.profile === "" || typeof b.policyDigest !== "string" || !HASH.test(b.policyDigest) ||
        typeof b.activationDigest !== "string" || !HASH.test(b.activationDigest) || !Number.isSafeInteger(b.policyRevision) ||
        typeof b.chain !== "string" || typeof b.safeBlockHash !== "string" || !/^0x[0-9a-f]{64}$/u.test(b.safeBlockHash) ||
        !isPlainRecord(b.account) || !isPlainRecord(b.plan) || !isPlainRecord(b.plan.request) || !isPlainRecord(b.plan.quote) ||
        !isPlainRecord(b.plan.price) || !isPlainRecord(b.plan.gas) || !isPlainRecord(b.unsignedOperation) || !isPlainRecord(b.paymaster)) {
        fail("binding_shape");
    }
    const r = b.plan.request;
    address(b.token);
    address(r.sender);
    address(r.recipient);
    address(b.unsignedOperation.sender);
    decimals([b.safeBlockNumber, b.account.entryPointNonce, b.account.eoaNonce, r.grossAtomic, r.maxFeeAtomic, r.minReceivedAtomic,
        b.plan.feeCapAtomic, b.plan.netAtomic, b.plan.quotedFeeAtomic]);
    try {
        decodeUsdtPaymasterData(b.paymasterData);
    }
    catch {
        fail("stored_paymaster_data");
    }
    const { bindingHash: _hash, ...bindingBody } = b, { integrityHash: _integrity, ...body } = value;
    if (b.bindingHash !== hashObject(bindingBody) || value.integrityHash !== hashObject(body) ||
        value.operationId !== hashObject({ schemaVersion: value.schemaVersion, profileHash: value.profileHash,
            idempotencyKey: value.idempotencyKey, bindingHash: b.bindingHash }))
        fail("binding_integrity");
    const freeze = (item) => { if (item !== null && typeof item === "object") {
        Object.values(item).forEach(freeze);
        Object.freeze(item);
    } };
    freeze(value);
    return value;
}
//# sourceMappingURL=bound-stored.js.map