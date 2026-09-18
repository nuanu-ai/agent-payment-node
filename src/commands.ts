import type { Address } from "./model.js";
import type { EvmAssetSelection, EvmChainId } from "./evm-asset.js";
import type { ErrorDetails } from "./errors.js";
import type { X402HttpRequestV1 } from "./x402-http-request.js";
import type { ChainProvider } from "./direct-rail-ports.js";
import type { BridgeRouteRequest } from "./lifi/model.js";
import type { GaslessCommandChainId, GaslessCommandRequest } from "./gasless/command-input.js";

export type CommandRequest =
  | { readonly command: "swap.uniswap.inventory" }
  | { readonly command: "swap.uniswap.quote"; readonly profile: string; readonly account: string; readonly recipient: string;
      readonly outputToken: string; readonly amountAtomic: string; readonly slippageBps: number; readonly ownerSlippageCapBps: number; readonly deadline: number;
      readonly maxGasLimit: string; readonly maxFeePerGas: string; readonly maxPriorityFeePerGas: string }
  | { readonly command: "swap.uniswap.prepare"; readonly profile: string; readonly quoteHash: string; readonly idempotencyKey: string }
  | { readonly command: "swap.uniswap.status" | "swap.uniswap.approve" | "swap.uniswap.execute"; readonly operationId: string }
  | { readonly command: "swap.sunswap.inventory" }
  | { readonly command: "swap.sunswap.quote"; readonly profile: string; readonly account: string; readonly recipient: string;
      readonly amountAtomic: string; readonly slippageBps: number; readonly ownerSlippageCapBps: number }
  | { readonly command: "swap.sunswap.prepare"; readonly profile: string; readonly quoteHash: string; readonly idempotencyKey: string }
  | { readonly command: "swap.sunswap.status" | "swap.sunswap.approve" | "swap.sunswap.execute"; readonly operationId: string }
  | { readonly command: "swap.jupiter.inventory" }
  | { readonly command: "swap.jupiter.quote"; readonly profile: string; readonly account: string; readonly recipient: string;
      readonly amountAtomic: string; readonly slippageBps: number; readonly ownerSlippageCapBps: number }
  | { readonly command: "swap.jupiter.prepare"; readonly profile: string; readonly quoteHash: string; readonly idempotencyKey: string }
  | { readonly command: "swap.jupiter.status" | "swap.jupiter.approve" | "swap.jupiter.execute"; readonly operationId: string }
  | { readonly command: "allowlist.inventory" }
  | { readonly command: "allowlist.resolve"; readonly chain: string; readonly kind: "native" | "token"; readonly identifier?: string }
  | { readonly command: "allowlist.policy.status"; readonly profile: string }
  | { readonly command: "allowlist.policy.stage"; readonly profile: string; readonly file: string; readonly expectedRevision?: number }
  | { readonly command: "allowlist.policy.activate" | "allowlist.policy.revoke"; readonly profile: string; readonly revision: number }
  | { readonly command: "allowlist.policy.prepare"; readonly profile: string; readonly account: string;
      readonly overlayVersion: string; readonly chain: string; readonly kind: "native" | "token"; readonly identifier?: string;
      readonly rail: "direct" | "gasless" | "x402" | "bridge" | "swap"; readonly maximumPerTransferAtomic: string;
      readonly dailyLimitAtomic: string; readonly effectiveAt: string; readonly expiresAt?: string;
      readonly mechanismProvider?: string; readonly mechanismReference?: string; readonly expectedRevision?: number }
  | { readonly command: "oneclick.source.submit"; readonly lane: string; readonly profile: string; readonly expectedPayer: string; readonly recipient: string; readonly amountAtomic: string; readonly minOutputAtomic: string; readonly maxQuotedLossAtomic: string; readonly maxGasLimitAtomic: string; readonly maxFeePerGasWei: string; readonly maxPriorityFeePerGasWei: string; readonly maxNativeDebitWei: string; readonly idempotencyKey: string }
  | { readonly command: "oneclick.source.status"; readonly operationId: string }
  | { readonly command: "circle.approval.prepare"; readonly profile: string; readonly approvalCapAtomic: string;
      readonly maxGasLimitAtomic: string; readonly maxFeePerGasWei: string; readonly maxPriorityFeePerGasWei: string;
      readonly maxNativeDebitWei: string }
  | { readonly command: "circle.approval.execute" | "circle.approval.status"; readonly operationId: string }
  | { readonly command: "circle.source.submit"; readonly profile: string; readonly expectedPayer: string;
      readonly recipientOwner: string; readonly recipientSetup: "existing_ata" | "create_ata"; readonly amountAtomic: string;
      readonly maxSourceFeeAtomic: string; readonly maxAllowanceAtomic: string; readonly maxGasLimitAtomic: string;
      readonly maxFeePerGasWei: string; readonly maxPriorityFeePerGasWei: string; readonly maxNativeDebitWei: string;
      readonly idempotencyKey: string }
  | { readonly command: "gasless.capabilities"; readonly profile?: string }
  | { readonly command: "gasless.balance"; readonly profile: string; readonly chainId: GaslessCommandChainId }
  | { readonly command: "gasless.transfer.prepare"; readonly profile: string; readonly request: GaslessCommandRequest; readonly idempotencyKey: string }
  | { readonly command: "gasless.transfer.approve"; readonly operationId: string }
  | { readonly command: "bridge.capabilities"; readonly profile?: string }
  | { readonly command: "bridge.inventory" }
  | { readonly command: "bridge.routes"; readonly profile: string; readonly request: BridgeRouteRequest }
  | { readonly command: "bridge.prepare"; readonly profile: string; readonly quote: string; readonly route: string; readonly idempotencyKey: string }
  | { readonly command: "bridge.approve"; readonly operationId: string }
  | { readonly command: "wallet.ensure-tron"; readonly profile: string; readonly provider: "local"; readonly acceptRisk: boolean }
  | { readonly command: "wallet.balance-tron"; readonly profile: string; readonly asset: "trx" | "usdt" }
  | { readonly command: "wallet.capabilities-tron"; readonly profile?: string }
  | { readonly command: "policy.admit-tron"; readonly profile: string; readonly asset: "trx" | "usdt"; readonly maximumPerTransfer: string; readonly dailyLimit: string; readonly maximumFee: string }
  | { readonly command: "transfer.prepare-tron"; readonly profile: string; readonly asset: "trx" | "usdt"; readonly recipient: string; readonly amount: string; readonly maximumFee: string; readonly idempotencyKey: string }
  | { readonly command: "wallet.ensure-solana"; readonly profile: string; readonly provider: ChainProvider; readonly acceptRisk: boolean }
  | { readonly command: "wallet.balance-solana"; readonly profile: string; readonly asset: "sol" | "usdc" }
  | { readonly command: "wallet.capabilities-solana"; readonly profile?: string }
  | { readonly command: "policy.admit-solana"; readonly profile: string; readonly asset: "sol" | "usdc"; readonly maximumPerTransfer: string; readonly dailyLimit: string; readonly maximumFee: string }
  | { readonly command: "transfer.prepare-solana"; readonly profile: string; readonly asset: "sol" | "usdc"; readonly recipient: string; readonly amount: string; readonly maximumFee: string; readonly idempotencyKey: string }
  | { readonly command: "version" }
  | { readonly command: "doctor.keychain" }
  | { readonly command: "wallet.ensure"; readonly profile: string }
  | { readonly command: "wallet.import"; readonly profile: string; readonly keyFile: string; readonly keyName: string; readonly expectedAddress: string }
  | {
    readonly command: "wallet.connect";
    readonly profile: string;
    readonly providerId: string;
    readonly authenticationMethod?: string;
    readonly expectedRevision?: number;
    readonly permissionCapUsdcAtomic?: string;
    readonly permissionExpiresAt?: number;
    readonly idempotencyKey?: string;
  }
  | { readonly command: "wallet.permission.list"; readonly profile: string }
  | { readonly command: "wallet.permission.sync"; readonly profile: string; readonly expectedRevision: number }
  | { readonly command: "wallet.permission.disable"; readonly profile: string; readonly expectedRevision: number }
  | { readonly command: "wallet.permission.forget"; readonly profile: string; readonly expectedRevision: number }
  | { readonly command: "wallet.status"; readonly profile: string }
  | { readonly command: "wallet.balance"; readonly profile: string; readonly asset?: EvmAssetSelection }
  | { readonly command: "wallet.portfolio"; readonly profile: string }
  | { readonly command: "wallet.policy.show"; readonly profile: string; readonly chainId?: EvmChainId }
  | {
    readonly command: "wallet.policy.set";
    readonly chainId?: EvmChainId;
    readonly profile: string;
    readonly maxBalanceUsdcAtomic: string;
    readonly maxX402AmountAtomic: string;
    readonly maxBalanceEthWei?: string;
  }
  | { readonly command: "x402.inspect"; readonly url: string; readonly httpRequest?: X402HttpRequestV1; readonly chainId?: EvmChainId }
  | {
    readonly command: "x402.fetch.prepare";
    readonly chainId?: EvmChainId;
    readonly httpRequest?: X402HttpRequestV1;
    readonly profile: string;
    readonly url: string;
    readonly maxAmountAtomic?: string;
    readonly idempotencyKey: string;
  }
  | { readonly command: "x402.fetch.approve"; readonly operationId: string }
  | {
    readonly command: "transfer.prepare";
    readonly profile: string;
    readonly idempotencyKey: string;
    readonly recipient: Address | string;
    readonly amount: string;
    readonly asset?: EvmAssetSelection;
    readonly maxFeeWei?: string;
  }
  | { readonly command: "transfer.approve"; readonly operationId: string }
  | { readonly command: "operation.resume"; readonly operationId: string; readonly waitSeconds?: number;
      readonly observationRpcEnv?: string }
  | { readonly command: "operation.abandon"; readonly operationId: string }
  | {
    readonly command: "operation.recover-provider-request";
    readonly operationId: string;
    readonly providerRequestId: string;
  }
  | {
    readonly command: "operation.recover-transaction-settlement";
    readonly operationId: string;
    readonly transactionHash: string;
    readonly idempotencyKey: string;
  }
  | { readonly command: "operation.status"; readonly operationId: string }
  | { readonly command: "receipt.get"; readonly operationId: string };

export interface CommandOutcome {
  readonly proofClass: string;
  readonly data: unknown | null;
  readonly operation: unknown | null;
  readonly receipt: unknown | null;
  readonly nextActions: readonly string[];
}

export interface OutputEnvelope {
  readonly version: "apn.cli.v1";
  readonly request_id: string;
  readonly command: string;
  readonly ok: boolean;
  readonly proof_class: string;
  readonly data: unknown | null;
  readonly operation: unknown | null;
  readonly receipt: unknown | null;
  readonly error: null | {
    readonly code: string;
    readonly message: string;
    readonly details?: ErrorDetails;
  };
  readonly next_actions: readonly string[];
}
