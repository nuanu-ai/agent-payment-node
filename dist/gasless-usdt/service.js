import { prepareUsdtOperation, refuseUsdtApproval, refuseUsdtDispatch, refuseUsdtRecovery, refuseUsdtSigner, resumeUsdtOperation, statusUsdtOperation, } from "./operation.js";
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
    approve() { return refuseUsdtApproval("approve"); }
    execute() { return refuseUsdtApproval("execute"); }
    sign() { return refuseUsdtSigner(); }
    dispatch() { return refuseUsdtDispatch(); }
    recover() { return refuseUsdtRecovery(); }
}
//# sourceMappingURL=service.js.map