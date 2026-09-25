import { keccak256, pad, parseTransaction, toHex } from "viem";
import * as coreRuntime from "../../src/core.js";
import { testRuntime } from "./installed-runtime.js";
import * as errorRuntime from "../../src/errors.js";
import { resolveEvmAsset } from "../../src/evm-asset.js";
import { directEvmQuoteFeeModel, directEvmRequiresSafeHead, type DirectEvmChainId } from "../../src/evm-direct-networks.js";
import type { EvmRpcPort } from "../../src/evm-ports.js";
import * as nativeRuntime from "../../src/local-wallet-native.js";
import type { WrappingSecretPort } from "../../src/macos-keychain.js";
import type { Address, Hex } from "../../src/model.js";
import type { NativePort } from "../../src/ports.js";
import { StateStore } from "../../src/state.js";
import type { TransferApprovalIntent, TransferApprovalPort } from "../../src/tty-approval.js";
import { RECIPIENT, TestClock, TestRpc } from "./helpers.js";
import { activateDirectPolicy, evmDirectAdmissions } from "./direct-allowlist-helpers.js";

const { ApnError } = await testRuntime(errorRuntime, "errors.js");
const { ApnCore } = await testRuntime(coreRuntime, "core.js");
const { LocalWalletNative } = await testRuntime(nativeRuntime, "local-wallet-native.js");

export const EVM_TOKEN = "0x4444444444444444444444444444444444444444" as Address;
export const EVM_BLOCK_HASH = `0x${"b".repeat(64)}` as Hex;
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as Hex;
export const EVM_REQUEST = {
  command: "transfer.prepare" as const, profile: "default", asset: { chainId: 8453 as const, token: "native" as const },
  recipient: RECIPIENT, amount: "0.000001", maxFeeWei: "1000000000000000", idempotencyKey: "evm-direct-first",
};

export class EvmWrappingSecret implements WrappingSecretPort {
  loads = 0;
  async load(): Promise<Buffer> { this.loads += 1; return Buffer.from("73".repeat(32), "hex"); }
  async create(): Promise<Buffer> { return Buffer.from("73".repeat(32), "hex"); }
}

export class EvmApproval implements TransferApprovalPort {
  readonly intents: TransferApprovalIntent[] = [];
  rejection: Error | null = null;
  async approve(intent: TransferApprovalIntent): Promise<void> {
    this.intents.push(intent);
    if (this.rejection !== null) throw this.rejection;
  }
}

export class EvmTestRpc extends TestRpc {
  assetAtomic = "100000000000000000000";
  nativeAtomic = "1000000000000000000";
  decimals: number | undefined = 6;
  l1Fee = 1000n;
  operatorFee = 100n;
  genericBalanceCalls = 0;
  transactionVerified = true;
  deltasVerified = true;
  receiptEnabled = true;
  transferLogEnabled = true;
  receiptStatus: "success" | "reverted" = "success";
  broadcastCount = 0;
  readonly evm: EvmRpcPort = {
    prepareBnbNative: () => ({
      balance: (address, selection) => this.evm.balance(address, selection),
      nonceEstimate: async (address, transaction) => ({
        nonce: await this.evm.nonce(56, address, "pending"), estimated: await this.evm.estimate(transaction),
      }),
      feeQuote: economics => this.evm.feeQuote(56, economics),
    }),
    assertChain: async (chainId) => { if (chainId !== this.chainId) throw new ApnError("APN_CHAIN_MISMATCH", "Wrong selected chain."); },
    balance: async (address, selection) => {
      this.genericBalanceCalls += 1;
      await this.evm.assertChain(selection.chainId);
      return { address, asset: resolveEvmAsset(selection, selection.token === "native" ? undefined : this.decimals),
        assetAtomic: selection.token === "native" ? this.nativeAtomic : this.assetAtomic, nativeAtomic: this.nativeAtomic,
        blockHash: EVM_BLOCK_HASH, blockNumberAtomic: "12345", observedAt: new Date().toISOString(), rpcOrigin: this.rpcOrigin };
    },
    nonce: async (chainId, _address, tag) => { await this.evm.assertChain(chainId); return tag === "pending" ? this.nonceAtomic : this.latestNonceAtomic; },
    estimate: async () => this.fees,
    feeQuote: async (chainId, economics) => ({ chainId, ...quoteFeeModel(chainId), maximumExecutionFeeWei: economics.maximumGasCostAtomic,
      l1DataFeeUpperWei: this.l1Fee.toString(), operatorFeeUpperWei: this.operatorFee.toString(),
      totalQuoteWei: (BigInt(economics.maximumGasCostAtomic) + this.l1Fee + this.operatorFee).toString(), totalFeeEnforcedOnchain: false,
      blockNumberAtomic: "12345", blockHash: EVM_BLOCK_HASH, observedAt: new Date().toISOString(), rpcOrigin: this.rpcOrigin }),
    receipt: async (chainId, transactionHash) => {
      await this.evm.assertChain(chainId);
      if (!this.receiptEnabled || this.submissions.length === 0) return null;
      const raw = this.submissions.at(-1)!;
      const transaction = parseTransaction(raw);
      const data = transaction.data;
      return { transactionHash, blockNumberAtomic: "12346", blockHash: EVM_BLOCK_HASH, status: this.receiptStatus,
        observedAt: new Date().toISOString(), rpcOrigin: this.rpcOrigin,
        logs: data === undefined || !this.transferLogEnabled ? [] : [{ address: transaction.to! as Address,
          topics: [TRANSFER_TOPIC, pad(this.sender, { size: 32 }), pad(RECIPIENT, { size: 32 })], data: toHex(BigInt(`0x${data.slice(-64)}`), { size: 32 }) }] };
    },
    evidence: async (operation) => ({ ...(directEvmRequiresSafeHead(operation.chainId) ? { safeBlockNumberAtomic: "12346", safeBlockHash: EVM_BLOCK_HASH } : {}), blockHash: EVM_BLOCK_HASH, transactionVerified: this.transactionVerified,
      tokenBalanceDeltasVerified: operation.evm?.asset.kind === "erc20" && this.deltasVerified,
      ...(operation.evm?.asset.kind === "erc20" ? { senderDeltaAtomic: operation.amountAtomic, recipientDeltaAtomic: this.deltasVerified ? operation.amountAtomic : "0" } : {}) }),
    confirmedAtNonce: async () => this.confirmedAtNonce,
  };
  sender: Address = RECIPIENT;

  override async submitRawTransaction(rawTransaction: Hex): Promise<Hex> {
    this.broadcastCount += 1;
    this.returnedHash = keccak256(rawTransaction);
    return await super.submitRawTransaction(rawTransaction);
  }
}

/** The fake quote names the same fee model the production RPC does for the selected network. */
function quoteFeeModel(chainId: DirectEvmChainId) {
  const feeModel = directEvmQuoteFeeModel(chainId);
  return feeModel === undefined ? {} : { feeModel };
}

export function evmCore(root: string, rpc = new EvmTestRpc(), wrapping = new EvmWrappingSecret(), approval = new EvmApproval(), wrapNative?: (native: NativePort) => NativePort) {
  const state = new StateStore(root), clock = new TestClock();
  clock.value = new Date();
  const local = new LocalWalletNative(state, wrapping, approval);
  const native = wrapNative?.(local) ?? local;
  const core = new ApnCore({ state, rpc, native, clock });
  return { core, state, rpc, wrapping, approval, local, clock };
}

/** A local wallet whose owner has activated direct caps for native and USDC on every enabled EVM network. */
export async function ensureDirectWallet(setup: ReturnType<typeof evmCore>, profile = "default"): Promise<{ readonly address: Address }> {
  const wallet = await setup.core.wallet.ensure(profile) as { address: Address };
  await activateDirectPolicy(setup.state.root, profile, { accounts: { evm: wallet.address }, admissions: evmDirectAdmissions(), now: setup.clock.now() });
  return wallet;
}
