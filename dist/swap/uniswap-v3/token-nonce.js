import { getAddress } from "viem";
import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../../canonical.js";
import { ApnError } from "../../errors.js";
import { SecureStateStore } from "../../secure-state-store.js";
/** Called while the shared account custody lock is held. Only reservations without a durable signed-effect marker may be reclaimed. */
export class UniswapTokenNonceStore extends SecureStateStore {
    async allocate(op, kind, pending, durable) {
        await this.initialize();
        await this.ensureDirectory("uniswap-token-nonces");
        const account = canonical(op.account), path = this.path(account), raw = await this.readJson(path), current = raw === null ? empty(account) : validate(raw, account), slot = nonceSlot(op.operationId, kind), prior = current.reservations[slot];
        if (prior !== undefined)
            return prior.nonce;
        const reservations = { ...current.reservations };
        for (const [key, reservation] of Object.entries(reservations)) {
            if (reservation.state !== "reserved")
                continue;
            if (await durable(reservation.operationId, reservation.kind))
                reservations[key] = { ...reservation, state: "committed" };
            else
                delete reservations[key];
        }
        const occupied = new Set(Object.values(reservations).map((reservation) => reservation.nonce));
        let nonce = pending;
        while (occupied.has(nonce.toString()))
            nonce += 1n;
        reservations[slot] = { operationId: op.operationId, kind, nonce: nonce.toString(), state: "reserved" };
        await this.writeJson(path, { schemaVersion: "apn.uniswap-token-nonces.v2", account, reservations }, raw === null);
        return nonce.toString();
    }
    async release(op, kind, nonce, durable) {
        const account = canonical(op.account), path = this.path(account), raw = await this.readJson(path);
        if (raw === null)
            corrupt("Uniswap token nonce record is missing.");
        const current = validate(raw, account), slot = nonceSlot(op.operationId, kind), reservation = current.reservations[slot];
        if (reservation === undefined)
            return false;
        exact(reservation, op, kind, nonce);
        if (reservation.state === "committed" || await durable(op.operationId, kind)) {
            if (reservation.state === "reserved")
                await this.writeJson(path, { ...current, reservations: { ...current.reservations, [slot]: { ...reservation, state: "committed" } } });
            return false;
        }
        const reservations = { ...current.reservations };
        delete reservations[slot];
        await this.writeJson(path, { ...current, reservations });
        return true;
    }
    async commit(op, kind, nonce) {
        const account = canonical(op.account), path = this.path(account), raw = await this.readJson(path);
        if (raw === null)
            corrupt("Uniswap token nonce record is missing.");
        const current = validate(raw, account), slot = nonceSlot(op.operationId, kind), reservation = current.reservations[slot];
        if (reservation === undefined)
            corrupt("Uniswap token nonce reservation is missing.");
        exact(reservation, op, kind, nonce);
        if (reservation.state === "committed")
            return;
        await this.writeJson(path, { ...current, reservations: { ...current.reservations, [slot]: { ...reservation, state: "committed" } } });
    }
    path(account) { return `uniswap-token-nonces/${domainHash("apn.uniswap-token-nonce-account.v1", account)}.json`; }
}
function empty(account) { return { schemaVersion: "apn.uniswap-token-nonces.v2", account, reservations: {} }; }
function nonceSlot(operationId, kind) { return domainHash("apn.uniswap-token-nonce-slot.v1", canonicalJson({ operationId, kind })); }
function validate(value, account) {
    if (!isPlainRecord(value) || value.account !== account || !isPlainRecord(value.reservations))
        corrupt("Uniswap token nonce record is invalid.");
    if (value.schemaVersion === "apn.uniswap-token-nonces.v1" && exactKeys(value, ["schemaVersion", "account", "nextNonce", "reservations"])) {
        if (!decimal(value.nextNonce))
            corrupt("Uniswap token nonce record is invalid.");
        const reservations = {};
        for (const [slot, nonce] of Object.entries(value.reservations)) {
            if (!slotHash(slot) || !decimal(nonce))
                corrupt("Uniswap token nonce reservation is invalid.");
            reservations[slot] = { nonce, state: "committed" };
        }
        return { schemaVersion: "apn.uniswap-token-nonces.v2", account, reservations };
    }
    if (value.schemaVersion !== "apn.uniswap-token-nonces.v2" || !exactKeys(value, ["schemaVersion", "account", "reservations"]))
        corrupt("Uniswap token nonce record is invalid.");
    for (const [slot, reservation] of Object.entries(value.reservations)) {
        if (!slotHash(slot) || !isPlainRecord(reservation) || !decimal(reservation.nonce) || !["reserved", "committed"].includes(reservation.state))
            corrupt("Uniswap token nonce reservation is invalid.");
        if (exactKeys(reservation, ["nonce", "state"])) {
            if (reservation.state !== "committed")
                corrupt("Uniswap token legacy nonce reservation is invalid.");
            continue;
        }
        if (!exactKeys(reservation, ["operationId", "kind", "nonce", "state"]) || !/^[a-f0-9]{64}$/u.test(reservation.operationId) ||
            !["approval", "swap", "cleanup"].includes(reservation.kind))
            corrupt("Uniswap token nonce binding is invalid.");
    }
    return value;
}
function exact(value, op, kind, nonce) {
    if (!("operationId" in value) || value.operationId !== op.operationId || value.kind !== kind || value.nonce !== nonce)
        corrupt("Uniswap token nonce binding changed.");
}
function decimal(value) { return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value); }
function slotHash(value) { return /^[a-f0-9]{64}$/u.test(value); }
function canonical(value) { try {
    const address = getAddress(value);
    if (address !== value)
        throw new Error();
    return address;
}
catch {
    return corrupt("Uniswap token nonce account is invalid.");
} }
function corrupt(message) { throw new ApnError("APN_STATE_CORRUPT", message); }
//# sourceMappingURL=token-nonce.js.map