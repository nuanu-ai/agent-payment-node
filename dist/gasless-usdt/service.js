import { UsdtBoundOperationRepository } from "./bound-operation.js";
import { ApnError } from "../errors.js";
/** Profile-bound access to the gasless USDT bound journal. No signer or dispatcher is reachable from here. */
export class GaslessUsdtOperationService {
    root;
    profileHash;
    constructor(root, profileHash) {
        this.root = root;
        this.profileHash = profileHash;
    }
    /** Bind an explicit persisted profile hash; profile names are never interpreted as hashes. */
    forProfile(profileHash) {
        return new GaslessUsdtOperationService(this.root, profileHash);
    }
    boundProfile() {
        if (this.profileHash === undefined)
            throw new Error("Gasless USDT operation profile binding is required.");
        return this.profileHash;
    }
    /** Persist the complete domain preparation. This cannot reserve usage or reach a signer. */
    async prepareBound(binding, idempotencyKey, now) {
        return new UsdtBoundOperationRepository(this.root).create(this.boundProfile(), binding, idempotencyKey, now);
    }
    async replayBound(idempotencyKey, intent) {
        return await new UsdtBoundOperationRepository(this.root).replay(this.boundProfile(), idempotencyKey, intent);
    }
    async statusBound(operationId) {
        const record = await new UsdtBoundOperationRepository(this.root).load(this.boundProfile(), operationId);
        if (record === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Gasless USDT bound operation was not found.", { reason: "bound_operation_not_found", rail: "gasless_usdt" });
        return record;
    }
}
//# sourceMappingURL=service.js.map