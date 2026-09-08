import { canonicalJson, hashObject, sha256 } from "../canonical.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { parseBridgeRoutes } from "./routes.js";
import { ownerSchema, providerBindingSchema } from "./schema.js";
import { bridgeExact, bridgeFailure, bridgeHash, bridgeIso, bridgeSame, validateBridgeRequest } from "./validation.js";
export function newBridgeQuote(input) {
    const body = { schemaVersion: "apn.bridge-quote.v1", ...input, requestHash: hashObject(input.request), responseHash: sha256(input.rawResponse),
        routes: parseBridgeRoutes({ status: 200, body: input.rawResponse }, input.request, input.owner.address).map((r) => r.choice) };
    return validateBridgeQuote({ ...body, snapshotHash: hashObject(body) });
}
export function validateBridgeQuote(value) {
    const r = bridgeExact(value, ["schemaVersion", "profileHash", "owner", "providerBinding", "request", "requestHash", "rawResponse", "responseHash", "routes", "createdAt", "snapshotHash"]);
    for (const k of ["profileHash", "requestHash", "responseHash", "snapshotHash"])
        bridgeHash(r[k]);
    bridgeIso(r.createdAt);
    if (r.schemaVersion !== "apn.bridge-quote.v1" || !ownerSchema.safeParse(r.owner).success || !providerBindingSchema.safeParse(r.providerBinding).success || typeof r.rawResponse !== "string")
        bridgeFailure("APN_STATE_CORRUPT", "bridge_quote_schema");
    const quote = r, { snapshotHash, ...body } = quote;
    validateBridgeRequest(quote.request, "APN_STATE_CORRUPT");
    if (snapshotHash !== hashObject(body) || quote.responseHash !== sha256(quote.rawResponse) || quote.requestHash !== hashObject(quote.request) ||
        quote.profileHash !== quote.owner.profileHash || quote.profileHash !== sha256(`profile\0${quote.owner.profile}`))
        bridgeFailure("APN_STATE_CORRUPT", "bridge_quote_binding");
    try {
        const routes = parseBridgeRoutes({ status: 200, body: quote.rawResponse }, quote.request, quote.owner.address).map((r) => r.choice);
        if (!bridgeSame(routes, quote.routes))
            bridgeFailure("APN_STATE_CORRUPT", "bridge_quote_routes");
    }
    catch {
        bridgeFailure("APN_STATE_CORRUPT", "bridge_quote_route_binding");
    }
    return quote;
}
export class BridgeQuoteRepository extends SecureStateStore {
    async save(quote) {
        validateBridgeQuote(quote);
        if (Buffer.byteLength(canonicalJson(quote), "utf8") + 1 > 1024 * 1024)
            bridgeFailure("APN_OPERATION_BLOCKED", "bridge_quote_capacity");
        await this.initialize();
        await this.ensureDirectory(`bridge-quotes/${quote.profileHash}`);
        const previous = await this.load(quote.profileHash, quote.snapshotHash);
        if (previous !== null)
            return;
        await this.writeJson(this.path(quote.profileHash, quote.snapshotHash), quote);
    }
    async load(profileHash, snapshotHash) {
        const value = await this.readJson(this.path(profileHash, snapshotHash));
        if (value === null)
            return null;
        const quote = validateBridgeQuote(value);
        if (quote.profileHash !== profileHash || quote.snapshotHash !== snapshotHash)
            bridgeFailure("APN_STATE_CORRUPT", "bridge_quote_owner");
        return quote;
    }
    path(profileHash, snapshotHash) {
        stateIdentifier(profileHash, "bridge quote profile");
        stateIdentifier(snapshotHash, "bridge quote hash");
        return `bridge-quotes/${profileHash}/${snapshotHash}.json`;
    }
}
//# sourceMappingURL=quote-repository.js.map