import type { CommandOutcome, CommandRequest, OutputEnvelope } from "./commands.js";
import { isPlainRecord } from "./canonical.js";
import { OUTPUT_VERSION } from "./constants.js";
import { failureEnvelope, successEnvelope } from "./output.js";
import { RuntimeContext, type CoreDependencies } from "./runtime.js";
import { TransferService } from "./transfer-service.js";
import { WalletService } from "./wallet-service.js";
import { OperationService } from "./operation-service.js";
import { inspectX402 } from "./x402-http.js";
import { canonicalOperationId } from "./transfer-policy.js";
import { X402Service } from "./x402-service.js";

export type { CommandRequest, OutputEnvelope } from "./commands.js";
export type { CoreDependencies } from "./runtime.js";

export class ApnCore {
  readonly context: RuntimeContext;
  readonly wallet: WalletService;
  readonly transfer: TransferService;
  readonly operations: OperationService;
  readonly x402: X402Service;

  constructor(dependencies: CoreDependencies) {
    this.context = new RuntimeContext(dependencies);
    this.wallet = new WalletService(this.context);
    this.transfer = new TransferService(this.context);
    this.operations = new OperationService(this.context.state);
    this.x402 = new X402Service(this.context);
  }

  async execute(request: CommandRequest): Promise<OutputEnvelope> {
    const requestId = this.context.ids.next();
    try {
      return successEnvelope(request, requestId, await this.dispatch(request));
    } catch (error) {
      return failureEnvelope(request.command, requestId, error);
    }
  }

  private async dispatch(request: CommandRequest): Promise<CommandOutcome> {
    switch (request.command) {
      case "version":
        return dataOutcome({
          product: "agent-payment-node",
          product_version: "0.2.4",
          cli_version: OUTPUT_VERSION,
          proof_class: "local_build_metadata",
        }, "local_build_metadata");
      case "doctor.keychain": return dataOutcome(await this.wallet.status("default"), "encrypted_apn_home_status");
      case "wallet.ensure": return dataOutcome(await this.wallet.ensure(request.profile), "encrypted_apn_home_status");
      case "wallet.status": return dataOutcome(await this.wallet.status(request.profile), "encrypted_apn_home_status");
      case "wallet.balance": return dataOutcome(await this.wallet.balance(request.profile), "chain_verified_public_read");
      case "x402.inspect": return dataOutcome(await inspectX402(this.context.requireHttp(), request.url), "seller_challenge_static");
      case "x402.fetch.prepare": return operationOutcome(await this.x402.prepare(request));
      case "x402.fetch.approve": {
        await this.x402.approve(request);
        return await this.operations.x402Outcome(request.operationId, {
          exposeSellerResult: true,
          exposeTerminalReceipt: true,
        });
      }
      case "transfer.prepare": return operationOutcome(await this.transfer.prepare(request));
      case "transfer.approve": return operationOutcome(await this.transfer.approve(request.operationId));
      case "operation.resume": {
        await this.context.ready();
        const operation = await this.operations.required(request.operationId);
        if (operation.kind === "x402_fetch") {
          await this.x402.resume(request.operationId);
          return await this.operations.x402Outcome(request.operationId, {
            exposeSellerResult: true,
            exposeTerminalReceipt: true,
          });
        }
        return operationOutcome(await this.transfer.resume(request.operationId));
      }
      case "operation.status": {
        canonicalOperationId(request.operationId);
        await this.context.ready();
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
        const operation = await this.operations.required(request.operationId);
        return operation.kind === "x402_fetch"
          ? await this.operations.x402ReceiptOutcome(request.operationId)
          : receiptOutcome(await this.transfer.receipt(request.operationId));
      }
    }
  }
}

function dataOutcome(data: unknown, fallbackProofClass: string): CommandOutcome {
  const artifact = artifactMetadata(data);
  return {
    proofClass: artifact.proofClass ?? fallbackProofClass,
    data,
    operation: null,
    receipt: null,
    nextActions: artifact.nextActions,
  };
}

function operationOutcome(operation: unknown): CommandOutcome {
  const artifact = artifactMetadata(operation);
  return {
    proofClass: artifact.proofClass ?? "durable_public_state",
    data: null,
    operation,
    receipt: null,
    nextActions: artifact.nextActions,
  };
}

function receiptOutcome(receipt: unknown): CommandOutcome {
  const artifact = artifactMetadata(receipt);
  return {
    proofClass: artifact.proofClass ?? "durable_public_state",
    data: null,
    operation: null,
    receipt,
    nextActions: artifact.nextActions,
  };
}

function artifactMetadata(value: unknown): { readonly proofClass?: string; readonly nextActions: readonly string[] } {
  const record = isPlainRecord(value) ? value : {};
  const proofClass = typeof record.proof_class === "string"
    ? record.proof_class
    : typeof record.proofClass === "string" ? record.proofClass : undefined;
  const actions = record.next_actions ?? record.nextActions;
  return {
    ...(proofClass === undefined ? {} : { proofClass }),
    nextActions: Array.isArray(actions) ? actions.filter((item): item is string => typeof item === "string") : [],
  };
}
