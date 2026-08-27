import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keccak256 } from "viem";
import { ApnCore } from "../../src/core.js";
import { sha256 } from "../../src/canonical.js";
import { BASE_USDC } from "../../src/constants.js";
import type { Address, Hex } from "../../src/model.js";
import type {
  BalanceSnapshot,
  ClockPort,
  FeeEstimate,
  HttpPort,
  NativePort,
  NativeRequest,
  RpcPort,
  RpcReceipt,
  X402PrepareEvidence,
} from "../../src/ports.js";
import { StateStore } from "../../src/state.js";

export const WALLET = "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1" as Address;
export const RECIPIENT = "0x2222222222222222222222222222222222222222" as Address;
export const OTHER_RECIPIENT = "0x3333333333333333333333333333333333333333" as Address;
export const RAW_TRANSACTION = "0x02f8b182210507843b9aca00847735940082fde894833589fcd6edb6e08f4c7c32d4f71b54bda0291380b844a9059cbb000000000000000000000000222222222222222222222222222222222222222200000000000000000000000000000000000000000000000000000000001312d0c001a0cfca94634c8dce4789253f5e467c677f467ead42437841946ce1996a3677c4d1a063ddba3fb209742363b737ca7613182596b4f58fe1b47bb869233fdb006cc751" as Hex;
export const TRANSACTION_HASH = keccak256(RAW_TRANSACTION);
export const BINDING_HASH = "a".repeat(64);
export const UUID = "12345678-1234-4234-8234-123456789abc";

export class TestClock implements ClockPort {
  value = new Date("2026-08-26T00:00:00.000Z");
  now(): Date { return new Date(this.value); }
  advance(milliseconds: number): void { this.value = new Date(this.value.getTime() + milliseconds); }
}

export class TestNative implements NativePort {
  readonly calls: NativeRequest[] = [];
  readonly rawTransaction: Hex;
  describeFound = true;
  walletAddress: Address = WALLET;
  bindingHash = BINDING_HASH;
  rejectMessage: string | null = null;

  constructor(rawTransaction: Hex = RAW_TRANSACTION) {
    this.rawTransaction = rawTransaction;
  }

  async request(request: NativeRequest): Promise<unknown> {
    this.calls.push(request);
    if (this.rejectMessage !== null) throw new Error(this.rejectMessage);
    if (request.operation === "wallet.ensure") {
      return {
        profile: request.payload.profile,
        address: this.walletAddress,
        createdAt: "2026-08-25T00:00:00.000Z",
        bindingHash: this.bindingHash,
      };
    }
    if (request.operation === "wallet.describe") {
      if (!this.describeFound) return { found: false };
      return {
        found: true,
        profile: request.payload.profile,
        address: this.walletAddress,
        createdAt: "2026-08-25T00:00:00.000Z",
        bindingHash: this.bindingHash,
      };
    }
    return {
      transactionHash: keccak256(this.rawTransaction),
      rawTransaction: this.rawTransaction,
      rawTransactionHash: keccak256(this.rawTransaction),
    };
  }
}

export class TestRpc implements RpcPort {
  chainId = 8453;
  rpcOrigin = "https://rpc.example";
  balances: BalanceSnapshot = {
    address: WALLET,
    ethAtomic: "1000000000000000000",
    usdcAtomic: "50000000",
    blockNumberAtomic: "12345",
    blockHash: `0x${"b".repeat(64)}`,
    observedAt: "2026-08-26T00:00:00.000Z",
    rpcOrigin: "https://rpc.example",
  };
  nonceAtomic = "7";
  fees: FeeEstimate = {
    gasLimitAtomic: "65000",
    maxFeePerGasAtomic: "2000000000",
    maxPriorityFeePerGasAtomic: "1000000000",
  };
  receipt: RpcReceipt | null = null;
  submitError: Error | null = null;
  returnedHash: Hex = TRANSACTION_HASH;
  latestNonceAtomic = "7";
  confirmedAtNonce: Hex | null = null;
  confirmedNonceStartBlockAtomic: string | null = null;
  x402Evidence: X402PrepareEvidence = {
    address: WALLET,
    usdcAtomic: "50000000",
    tokenName: "USD Coin",
    tokenVersion: "2",
    domainSeparator: "0x02fa7265e7c5d81118673727957699e4d68f74cd74b7db77da710fe8a2c7834f",
    rpcOriginHash: sha256("https://rpc.example"),
    observedAt: "2026-08-26T00:00:00.000Z",
    queriedTag: "safe",
    block: {
      number: "12345",
      hash: `0x${"b".repeat(64)}` as Hex,
      timestamp: "1787702400",
    },
  };
  readonly submissions: Hex[] = [];
  balanceCalls = 0;
  nonceCalls = 0;
  x402PrepareCalls = 0;

  async assertBaseChain(): Promise<{ readonly chainId: 8453; readonly rpcOrigin: string }> {
    if (this.chainId !== 8453) throw new Error("wrong chain");
    return { chainId: 8453, rpcOrigin: this.rpcOrigin };
  }
  async getBalances(address: Address): Promise<BalanceSnapshot> {
    this.balanceCalls += 1;
    return { ...this.balances, address };
  }
  async getPendingNonce(_address: Address): Promise<string> {
    this.nonceCalls += 1;
    return this.nonceAtomic;
  }
  async getX402PrepareEvidence(address: Address): Promise<X402PrepareEvidence> {
    this.x402PrepareCalls += 1;
    void address;
    return { ...this.x402Evidence, block: { ...this.x402Evidence.block } };
  }
  async estimateDirectTransfer(input: { readonly from: Address; readonly to: Address; readonly data: Hex }): Promise<FeeEstimate> {
    if (input.to !== BASE_USDC) throw new Error("wrong token");
    return this.fees;
  }
  async submitRawTransaction(rawTransaction: Hex): Promise<Hex> {
    this.submissions.push(rawTransaction);
    if (this.submitError !== null) throw this.submitError;
    return this.returnedHash;
  }
  async getReceipt(_transactionHash: Hex): Promise<RpcReceipt | null> { return this.receipt; }
  async getLatestConfirmedNonce(_address: Address): Promise<string> { return this.latestNonceAtomic; }
  async getConfirmedTransactionAtNonce(
    _address: Address,
    _nonceAtomic: string,
    startBlockNumberAtomic: string,
  ): Promise<Hex | null> {
    this.confirmedNonceStartBlockAtomic = startBlockNumberAtomic;
    return this.confirmedAtNonce;
  }
}

export async function temporaryState(): Promise<{ readonly base: string; readonly root: string; cleanup(): Promise<void> }> {
  const canonicalTmp = await realpath(tmpdir());
  const base = await mkdtemp(join(canonicalTmp, "apn-core-"));
  return {
    base,
    root: join(base, "state"),
    cleanup: async () => await rm(base, { recursive: true, force: true }),
  };
}

export function makeCore(input: {
  readonly root: string;
  readonly native?: NativePort;
  readonly rpc?: RpcPort;
  readonly clock?: TestClock;
  readonly http?: HttpPort;
}): ApnCore {
  return new ApnCore({
    state: new StateStore(input.root, { lockWaitMs: 1_000, lockLeaseMs: 100 }),
    ...(input.native === undefined ? {} : { native: input.native }),
    ...(input.rpc === undefined ? {} : { rpc: input.rpc }),
    ...(input.http === undefined ? {} : { http: input.http }),
    clock: input.clock ?? new TestClock(),
    ids: { next: () => UUID },
  });
}

export async function ensureWallet(core: ApnCore): Promise<void> {
  const result = await core.execute({ command: "wallet.ensure", profile: "default" });
  if (!result.ok) throw new Error(`wallet setup failed: ${result.error?.code ?? "unknown"}`);
}

export async function prepareTransfer(core: ApnCore, key = "payment-001"): Promise<string> {
  const result = await core.execute({
    command: "transfer.prepare",
    profile: "default",
    idempotencyKey: key,
    recipient: RECIPIENT,
    amount: "1.25",
  });
  if (!result.ok) throw new Error(`prepare failed: ${result.error?.code ?? "unknown"}`);
  const operation = result.operation as { readonly operation_id?: unknown } | null;
  if (typeof operation?.operation_id !== "string") throw new Error("prepare did not return an operation ID");
  return operation.operation_id;
}

export function exactReceipt(): RpcReceipt {
  return {
    transactionHash: TRANSACTION_HASH,
    status: "success",
    blockNumberAtomic: "12350",
    observedAt: "2026-08-26T00:01:00.000Z",
    rpcOrigin: "https://rpc.example",
    logs: [{
      address: BASE_USDC,
      topics: [
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        `0x${WALLET.slice(2).padStart(64, "0")}` as Hex,
        `0x${RECIPIENT.slice(2).padStart(64, "0")}` as Hex,
      ],
      data: `0x${(1_250_000n).toString(16).padStart(64, "0")}` as Hex,
    }],
  };
}
