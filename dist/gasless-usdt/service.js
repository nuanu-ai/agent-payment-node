import { prepareUsdtOperation, refuseUsdtApproval, refuseUsdtDispatch, refuseUsdtRecovery, refuseUsdtSigner, resumeUsdtOperation, statusUsdtOperation, } from "./operation.js";
import { classifyUsdtBoundRecovery, UsdtBoundOperationRepository } from "./bound-operation.js";
import { ApnError } from "../errors.js";
/** Read-only operation boundary for the gasless USDT foundation. No signer or dispatcher is reachable. */
export class GaslessUsdtOperationService {
    repository;
    profileHash;
    constructor(repository, profileHash) {
        this.repository = repository;
        this.profileHash = profileHash;
    }
    /** Bind an explicit persisted profile hash; profile names are never interpreted as hashes. */
    forProfile(profileHash) {
        return new GaslessUsdtOperationService(this.repository, profileHash);
    }
    boundProfile() {
        if (this.profileHash === undefined)
            throw new Error("Gasless USDT operation profile binding is required.");
        return this.profileHash;
    }
    async prepare(input, idempotencyKey) {
        return prepareUsdtOperation(this.repository, { ...input, profileHash: this.boundProfile() }, idempotencyKey);
    }
    async status(operationId) {
        return statusUsdtOperation(this.repository, this.boundProfile(), operationId);
    }
    async resume(operationId) {
        return resumeUsdtOperation(this.repository, this.boundProfile(), operationId);
    }
    /** Persist the complete domain preparation. This cannot reserve usage or reach a signer. */
    async prepareBound(binding, idempotencyKey, now) {
        return new UsdtBoundOperationRepository(this.repository.root).create(this.boundProfile(), binding, idempotencyKey, now);
    }
    async statusBound(operationId) {
        const record = await new UsdtBoundOperationRepository(this.repository.root).load(this.boundProfile(), operationId);
        if (record === null)
            throw new ApnError("APN_OPERATION_NOT_FOUND", "Gasless USDT bound operation was not found.", { reason: "bound_operation_not_found", rail: "gasless_usdt" });
        return record;
    }
    /** Fresh, read-only recovery classification. No saved state is changed. */
    async resumeBound(operationId, port) {
        return classifyUsdtBoundRecovery(await this.statusBound(operationId), port);
    }
    approve() { return refuseUsdtApproval("approve"); }
    execute() { return refuseUsdtApproval("execute"); }
    sign() { return refuseUsdtSigner(); }
    dispatch() { return refuseUsdtDispatch(); }
    recover() { return refuseUsdtRecovery(); }
}
//# sourceMappingURL=service.js.map