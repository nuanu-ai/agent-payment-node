import type { Address, Hex } from "./model.js";

export interface ClockPort {
  now(): Date;
}

export interface IdPort {
  next(): string;
}

export interface NativeRequest {
  readonly version: "apn.native.v1";
  readonly requestId: string;
  readonly operation:
    | "wallet.describe"
    | "wallet.ensure"
    | "directTransfer.approveAndSign"
    | "effectMaterial.get";
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface NativePort {
  request(request: NativeRequest): Promise<unknown>;
}

export interface RpcProvenance {
  readonly blockNumberAtomic: string;
  readonly blockHash: Hex;
  readonly observedAt: string;
  readonly rpcOrigin: string;
}

export interface BalanceSnapshot extends RpcProvenance {
  readonly address: Address;
  readonly ethAtomic: string;
  readonly usdcAtomic: string;
}

export interface FeeEstimate {
  readonly gasLimitAtomic: string;
  readonly maxFeePerGasAtomic: string;
  readonly maxPriorityFeePerGasAtomic: string;
}

export interface RpcLog {
  readonly address: Address;
  readonly topics: readonly Hex[];
  readonly data: Hex;
}

export interface RpcReceipt {
  readonly transactionHash: Hex;
  readonly status: "success" | "reverted";
  readonly blockNumberAtomic: string;
  readonly logs: readonly RpcLog[];
  readonly observedAt: string;
  readonly rpcOrigin: string;
}

export interface RpcPort {
  assertBaseChain(): Promise<{ readonly chainId: 8453; readonly rpcOrigin: string }>;
  getBalances(address: Address): Promise<BalanceSnapshot>;
  getPendingNonce(address: Address): Promise<string>;
  estimateDirectTransfer(input: {
    readonly from: Address;
    readonly to: Address;
    readonly data: Hex;
  }): Promise<FeeEstimate>;
  submitRawTransaction(rawTransaction: Hex): Promise<Hex>;
  getReceipt(transactionHash: Hex): Promise<RpcReceipt | null>;
  getLatestConfirmedNonce(address: Address): Promise<string>;
  getConfirmedTransactionAtNonce(
    address: Address,
    nonceAtomic: string,
    startBlockNumberAtomic: string,
  ): Promise<Hex | null>;
}
