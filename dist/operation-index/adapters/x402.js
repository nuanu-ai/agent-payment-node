import { ApnError } from "../../errors.js";
import { abandonProviderX402 } from "../../operation-abandon-provider.js";
import { assertResumeOptions } from "../../operation-command-options.js";
import { evmConflictDomain, sharedEvmConflictDomain } from "../../operation-conflict-domain.js";
import { localX402Outcome, providerX402Outcome, x402ReceiptOutcome } from "../../operation-x402-outcome.js";
import { PROVIDER_X402_TERMINAL_STATES, publicProviderX402Operation } from "../../provider-x402-model.js";
import { ProviderX402Repository } from "../../provider-x402-repository.js";
import { StateStore } from "../../state.js";
import { X402AbandonService } from "../../x402-abandon.js";
import { X402Service } from "../../x402-service.js";
import { publicX402Operation } from "../../x402-state-integrity.js";
import { STATE_SHAPE } from "../../x402-state-shape.js";
import { domainClaims, field, readableClaims, requiredRecordPath, salvageEvm, salvageRecord, standardIdentity } from "../adapter.js";
import { providerClaims, UNREADABLE_PROVIDER_CLAIM } from "../types.js";
import { OperationService } from "../../operation-service.js";
import { salvageProvider } from "./direct.js";
const STORE = { directory: "x402-operations", perProfile: true };
const LOCAL_SCHEMA = "apn.x402.state.v1";
const PROVIDER_SCHEMAS = ["apn.provider-x402.state.v1", "apn.provider-x402.state.v2"];
export function x402Domains(operation) {
    // A local EIP-3009 authorization or Permit2 witness transfer spends by its own random nonce: it shares the account with
    // other purchases only.
    if (operation.strategy === "local" && ["eip3009", "permit2"].includes(operation.record.selectedOffer.resolved.assetTransferMethod)) {
        return [sharedEvmConflictDomain(operation.record.chainId, operation.record.wallet)];
    }
    // Provider-atomic x402 is Base-only; its record carries the network as CAIP-2 instead of a chain id.
    return [operation.strategy === "local" ? evmConflictDomain(operation.record.chainId, operation.record.wallet)
            : evmConflictDomain(8453, operation.record.provider.payer)];
}
export function x402Terminal(operation) {
    return operation.strategy === "local" ? Object.hasOwn(STATE_SHAPE, operation.record.state) && STATE_SHAPE[operation.record.state].terminal
        : PROVIDER_X402_TERMINAL_STATES.includes(operation.record.state);
}
export const x402Adapter = {
    family: "x402_fetch",
    stores: [STORE],
    async load(root, recordPath) {
        const { profileHash, operationId } = requiredRecordPath(recordPath, STORE);
        const local = await new StateStore(root).loadX402Operation(profileHash, operationId);
        if (local !== null)
            return { strategy: "local", record: local };
        const provider = await new ProviderX402Repository(root).loadOperation(profileHash, operationId);
        return provider === null ? null : { strategy: "provider_atomic", record: provider };
    },
    identity: operation => standardIdentity(operation.record),
    claims: operation => readableClaims(() => [
        ...domainClaims(x402Domains(operation)),
        ...(operation.strategy === "local" ? [] : providerClaims(operation.record.provider.providerId, operation.record.provider.accountBindingHash, operation.record.provider.payer)),
    ]),
    // The family's own outcome tables, which its validators tie each record's `terminal` flag to.
    terminal: x402Terminal,
    state: operation => operation.record.state,
    salvage: raw => salvageRecord(raw, value => {
        const schema = field(value, "schemaVersion");
        if (schema === LOCAL_SCHEMA) {
            return [salvageEvm(field(value, "chainId"), field(value, "wallet"), ["eip3009", "permit2"].includes(String(field(value, "selectedOffer", "resolved", "assetTransferMethod"))))];
        }
        if (!PROVIDER_SCHEMAS.includes(schema))
            throw new Error("Unknown x402 schema.");
        return [salvageEvm(8453, field(value, "provider", "payer")),
            ...salvageProvider(field(value, "provider", "providerId"), field(value, "provider", "accountBindingHash"), field(value, "provider", "payer"))];
    }),
    unknownClaims: [UNREADABLE_PROVIDER_CLAIM],
    view: async (operation) => operation.strategy === "local"
        ? publicX402Operation(operation.record) : publicProviderX402Operation(operation.record),
    // A provider purchase first recovers an interrupted read; the outcome is then built from the record saved after it.
    async status(context, { record }) {
        await new X402Service(context).recoverRead(record.operationId);
        return await savedOutcome(context, record.operationId, { exposeSellerResult: false, exposeTerminalReceipt: false });
    },
    async receipt(context, { record }) {
        await new X402Service(context).recoverRead(record.operationId);
        return await x402StoredReceiptOutcome(context.state, providerReceipts(context), await saved(context, record.operationId));
    },
    async resume(context, { record }, options) {
        assertResumeOptions(options, {});
        const settlementWait = await new X402Service(context).resume(record.operationId, options.waitSeconds);
        return await savedOutcome(context, record.operationId, { exposeSellerResult: true, exposeTerminalReceipt: true,
            ...(settlementWait === undefined ? {} : { settlementWait }) });
    },
    abandon: async (context, operation) => operation.strategy === "local"
        ? await new X402AbandonService(context).abandon(operation.record.operationId)
        : await abandonProviderX402(context, new OperationService(context.state), operation.record.operationId),
};
const providerReceipts = (context) => context.providerX402Repository ?? new ProviderX402Repository(context.state.root);
async function saved(context, operationId) {
    const found = await new OperationService(context.state).required(operationId);
    if (found.kind !== "x402_fetch")
        throw new ApnError("APN_OPERATION_BLOCKED", "Operation is not an x402 fetch.");
    return found;
}
async function savedOutcome(context, operationId, options) {
    return await x402StoredOutcome(context.state, providerReceipts(context), await saved(context, operationId), options);
}
/** The status/resume outcome of a saved purchase, with its linked seller result and terminal receipt. */
export async function x402StoredOutcome(state, providerReceipts, found, options) {
    if (found.strategy === "provider_atomic") {
        const operation = found.record;
        const receipt = operation.terminal && options.exposeTerminalReceipt
            ? await providerReceipts.loadReceipt(operation.profileHash, operation.operationId)
            : null;
        if (operation.terminal && options.exposeTerminalReceipt && receipt === null) {
            throw new ApnError("APN_STATE_CORRUPT", "Terminal provider x402 operation has no public receipt.");
        }
        return providerX402Outcome(operation, receipt, options);
    }
    const operation = found.record;
    const result = operation.resultLink === undefined
        ? null
        : await state.loadX402Result(operation.profileHash, operation.operationId);
    if (operation.resultLink !== undefined && result === null) {
        throw new ApnError("APN_STATE_CORRUPT", "x402 operation has a dangling public result link.");
    }
    const receipt = operation.terminal && options.exposeTerminalReceipt
        ? await state.loadX402Receipt(operation.profileHash, operation.operationId)
        : null;
    if (operation.terminal && options.exposeTerminalReceipt && receipt === null) {
        throw new ApnError("APN_STATE_CORRUPT", "Terminal x402 operation has no public receipt.");
    }
    return localX402Outcome(operation, result, receipt, options);
}
export async function x402StoredReceiptOutcome(state, providerReceipts, found) {
    if (found.strategy === "provider_atomic") {
        const receipt = await providerReceipts.loadReceipt(found.record.profileHash, found.record.operationId);
        if (receipt === null)
            throw new ApnError("APN_RECEIPT_NOT_FOUND", "Durable receipt is not available.");
        return x402ReceiptOutcome({ variant: "normalized_provider_json", operation: found.record, receipt });
    }
    const receipt = await state.loadX402Receipt(found.record.profileHash, found.record.operationId);
    if (receipt === null)
        throw new ApnError("APN_RECEIPT_NOT_FOUND", "Durable receipt is not available.");
    return x402ReceiptOutcome({ variant: "local", receipt });
}
//# sourceMappingURL=x402.js.map