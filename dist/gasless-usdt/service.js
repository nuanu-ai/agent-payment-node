import { prepareUsdtOperation, refuseUsdtApproval, refuseUsdtDispatch, refuseUsdtRecovery, refuseUsdtSigner, resumeUsdtOperation, statusUsdtOperation, } from "./operation.js";
/** Read-only operation boundary for the gasless USDT foundation. No signer or dispatcher is reachable. */
export class GaslessUsdtOperationService {
    repository;
    profileHash;
    constructor(repository, profileHash) {
        this.repository = repository;
        this.profileHash = profileHash;
    }
    async prepare(input, idempotencyKey) {
        return prepareUsdtOperation(this.repository, { ...input, profileHash: this.profileHash }, idempotencyKey);
    }
    async status(operationId) {
        return statusUsdtOperation(this.repository, this.profileHash, operationId);
    }
    async resume(operationId) {
        return resumeUsdtOperation(this.repository, this.profileHash, operationId);
    }
    approve() { return refuseUsdtApproval("approve"); }
    execute() { return refuseUsdtApproval("execute"); }
    sign() { return refuseUsdtSigner(); }
    dispatch() { return refuseUsdtDispatch(); }
    recover() { return refuseUsdtRecovery(); }
}
//# sourceMappingURL=service.js.map