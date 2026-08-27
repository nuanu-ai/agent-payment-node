import { ApnError } from "./errors.js";
import { canonicalOperationId, publicOperation } from "./transfer-policy.js";
import { publicX402Operation } from "./x402-state-integrity.js";
export class OperationService {
    state;
    constructor(state) {
        this.state = state;
    }
    async resolvePrepare(input) {
        const matches = [
            ...(await this.state.listAllOperations()).filter((operation) => operation.idempotencyHash === input.idempotencyHash).map((record) => ({ kind: "direct_transfer", record })),
            ...(await this.state.listAllX402Operations()).filter((operation) => operation.idempotencyHash === input.idempotencyHash).map((record) => ({ kind: "x402_fetch", record })),
        ];
        if (matches.length > 1)
            throw new ApnError("APN_STATE_CORRUPT", "Idempotency identity is duplicated across operation stores.");
        const existing = matches[0];
        if (existing === undefined)
            return null;
        if (existing.kind !== input.kind || existing.record.profileHash !== input.profileHash ||
            existing.record.operationId !== input.operationId || existing.record.requestHash !== input.requestHash)
            throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Idempotency key is already bound to different operation inputs.");
        return existing;
    }
    async assertProfileAvailable(profileHash) {
        const active = [
            ...(await this.state.listOperations(profileHash)).map((record) => ({ kind: "direct_transfer", record })),
            ...(await this.state.listX402Operations(profileHash)).map((record) => ({ kind: "x402_fetch", record })),
        ];
        const blocking = active.find(({ record }) => !record.terminal);
        if (blocking !== undefined) {
            throw new ApnError("APN_OPERATION_BLOCKED", "Another money operation for this profile is not terminal.", {
                blockingOperationId: blocking.record.operationId,
                blockingState: blocking.record.state,
            });
        }
    }
    async required(operationId) {
        const canonicalId = canonicalOperationId(operationId);
        const direct = await this.state.findOperation(canonicalId);
        const x402 = await this.state.findX402Operation(canonicalId);
        if (direct !== null && x402 !== null)
            throw new ApnError("APN_STATE_CORRUPT", "Operation ID is duplicated across operation stores.");
        if (direct !== null)
            return { kind: "direct_transfer", record: direct };
        if (x402 !== null)
            return { kind: "x402_fetch", record: x402 };
        throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
    }
    async status(operationId) {
        const operation = await this.required(operationId);
        return operation.kind === "direct_transfer" ? publicOperation(operation.record) : publicX402Operation(operation.record);
    }
}
//# sourceMappingURL=operation-service.js.map