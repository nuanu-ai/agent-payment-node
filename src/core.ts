import type { CommandRequest, OutputEnvelope } from "./commands.js";
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

  private async dispatch(request: CommandRequest): Promise<unknown> {
    switch (request.command) {
      case "version":
        return {
          product: "agent-payment-node",
          product_version: "0.1.0",
          cli_version: OUTPUT_VERSION,
          proof_class: "local_build_metadata",
        };
      case "doctor.keychain": return await this.wallet.status("default");
      case "wallet.ensure": return await this.wallet.ensure(request.profile);
      case "wallet.status": return await this.wallet.status(request.profile);
      case "wallet.balance": return await this.wallet.balance(request.profile);
      case "x402.inspect": return await inspectX402(this.context.requireHttp(), request.url);
      case "x402.fetch.prepare": return await this.x402.prepare(request);
      case "x402.fetch.approve": return await this.x402.approve(request);
      case "transfer.prepare": return await this.transfer.prepare(request);
      case "transfer.approve": return await this.transfer.approve(request.operationId);
      case "operation.resume": {
        await this.context.ready();
        const operation = await this.operations.required(request.operationId);
        return operation.kind === "x402_fetch"
          ? await this.x402.resume(request.operationId)
          : await this.transfer.resume(request.operationId);
      }
      case "operation.status":
        canonicalOperationId(request.operationId);
        await this.context.ready();
        return await this.operations.status(request.operationId);
      case "receipt.get": return await this.transfer.receipt(request.operationId);
    }
  }
}
