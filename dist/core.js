import { isPlainRecord } from "./canonical.js";
import { OUTPUT_VERSION, PRODUCT_VERSION } from "./constants.js";
import { failureEnvelope, successEnvelope } from "./output.js";
import { RuntimeContext } from "./runtime.js";
import { TransferService } from "./transfer-service.js";
import { WalletService } from "./wallet-service.js";
import { OperationService } from "./operation-service.js";
import { inspectX402 } from "./x402-http.js";
import { canonicalOperationId } from "./transfer-policy.js";
import { X402Service } from "./x402-service.js";
import { ApnError } from "./errors.js";
import { ProviderWalletService } from "./provider-wallet-service.js";
export class ApnCore {
    context;
    wallet;
    transfer;
    operations;
    x402;
    providerWallet;
    constructor(dependencies) {
        this.context = new RuntimeContext(dependencies);
        this.wallet = new WalletService(this.context);
        this.transfer = new TransferService(this.context);
        this.operations = new OperationService(this.context.state, this.context.providerX402Repository);
        this.x402 = new X402Service(this.context);
        this.providerWallet = new ProviderWalletService(this.context);
    }
    async execute(request) {
        const requestId = this.context.ids.next();
        try {
            return successEnvelope(request, requestId, await this.dispatch(request));
        }
        catch (error) {
            return failureEnvelope(request.command, requestId, error);
        }
    }
    async dispatch(request) {
        switch (request.command) {
            case "version":
                return dataOutcome({
                    product: "agent-payment-node",
                    product_version: PRODUCT_VERSION,
                    cli_version: OUTPUT_VERSION,
                    proof_class: "local_build_metadata",
                }, "local_build_metadata");
            case "doctor.keychain": return dataOutcome(await this.wallet.doctorKeychain(), "encrypted_apn_home_status");
            case "wallet.ensure": return dataOutcome(await this.wallet.ensure(request.profile), "encrypted_apn_home_status");
            case "wallet.connect": return dataOutcome(await this.providerWallet.connect(request), "provider_profile_binding");
            case "wallet.status": {
                const providerStatus = await this.providerWallet.status(request.profile);
                return providerStatus === null
                    ? dataOutcome(await this.wallet.status(request.profile), "encrypted_apn_home_status")
                    : dataOutcome(providerStatus, "provider_profile_binding");
            }
            case "wallet.balance": return dataOutcome(await this.providerWallet.balance(request.profile) ?? await this.wallet.balance(request.profile), "chain_verified_public_read");
            case "wallet.policy.show": return dataOutcome(await this.wallet.policyShow(request.profile), "encrypted_profile_policy_status");
            case "wallet.policy.set": return dataOutcome(await this.wallet.policySet(request), "encrypted_profile_policy_status");
            case "x402.inspect": return dataOutcome(await inspectX402(this.context.requireHttp(), request.url), "seller_challenge_static");
            case "x402.fetch.prepare": {
                await this.providerWallet.assertPaymentAvailable(request.profile, "x402");
                return operationOutcome(await this.x402.prepare(request));
            }
            case "x402.fetch.approve": {
                await this.x402.approve(request);
                return await this.operations.x402Outcome(request.operationId, {
                    exposeSellerResult: true,
                    exposeTerminalReceipt: true,
                });
            }
            case "transfer.prepare": {
                await this.providerWallet.assertPaymentAvailable(request.profile, "direct");
                return operationOutcome(await this.transfer.prepare(request));
            }
            case "transfer.approve": return operationOutcome(await this.transfer.approve(request.operationId));
            case "operation.resume": {
                await this.context.ready();
                const operation = await this.operations.required(request.operationId);
                if (operation.kind === "x402_fetch") {
                    const settlementWait = await this.x402.resume(request.operationId, request.waitSeconds);
                    return await this.operations.x402Outcome(request.operationId, {
                        exposeSellerResult: true,
                        exposeTerminalReceipt: true,
                        ...(settlementWait === undefined ? {} : { settlementWait }),
                    });
                }
                if (request.waitSeconds !== undefined) {
                    throw new ApnError("APN_INVALID_INPUT", "--wait-seconds is only available for x402 operations.");
                }
                return operationOutcome(await this.transfer.resume(request.operationId));
            }
            case "operation.status": {
                canonicalOperationId(request.operationId);
                await this.context.ready();
                await this.x402.recoverRead(request.operationId);
                const operation = await this.operations.required(request.operationId);
                return operation.kind === "x402_fetch"
                    ? await this.operations.x402Outcome(request.operationId, {
                        exposeSellerResult: false,
                        exposeTerminalReceipt: false,
                    })
                    : operationOutcome(await this.operations.status(request.operationId));
            }
            case "receipt.get": {
                canonicalOperationId(request.operationId);
                await this.context.ready();
                await this.x402.recoverRead(request.operationId);
                const operation = await this.operations.required(request.operationId);
                return operation.kind === "x402_fetch"
                    ? await this.operations.x402ReceiptOutcome(request.operationId)
                    : receiptOutcome(await this.transfer.receipt(request.operationId));
            }
        }
    }
}
function dataOutcome(data, fallbackProofClass) {
    const artifact = artifactMetadata(data);
    return {
        proofClass: artifact.proofClass ?? fallbackProofClass,
        data,
        operation: null,
        receipt: null,
        nextActions: artifact.nextActions,
    };
}
function operationOutcome(operation) {
    const artifact = artifactMetadata(operation);
    return {
        proofClass: artifact.proofClass ?? "durable_public_state",
        data: null,
        operation,
        receipt: null,
        nextActions: artifact.nextActions,
    };
}
function receiptOutcome(receipt) {
    const artifact = artifactMetadata(receipt);
    return {
        proofClass: artifact.proofClass ?? "durable_public_state",
        data: null,
        operation: null,
        receipt,
        nextActions: artifact.nextActions,
    };
}
function artifactMetadata(value) {
    const record = isPlainRecord(value) ? value : {};
    const proofClass = typeof record.proof_class === "string"
        ? record.proof_class
        : typeof record.proofClass === "string" ? record.proofClass : undefined;
    const actions = record.next_actions ?? record.nextActions;
    return {
        ...(proofClass === undefined ? {} : { proofClass }),
        nextActions: Array.isArray(actions) ? actions.filter((item) => typeof item === "string") : [],
    };
}
//# sourceMappingURL=core.js.map