/** Read-only Arbitrum source finality. A proof here says nothing about Ethereum delivery. */
import type { Hex } from "viem";
import { ApnError } from "../errors.js";
import { EvmDirectRpcGuard } from "../evm-direct-rpc-guard.js";
import { evmRpcAddress, evmRpcBlockResult, evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../evm-rpc-codec.js";
import { HttpsBaseRpc, type ReadOnlyRpcBatchCall } from "../rpc.js";
import type { StateStore } from "../state.js";

const HASH = /^0x[0-9a-fA-F]{64}$/u;
const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const invalid = (reason: string): never => { throw new ApnError("APN_RPC_PROTOCOL", "Relay Arbitrum source proof is invalid.", { reason }); };

export interface RelayArbitrumExpectedEffect {
  readonly transactionHash: Hex;
  readonly from: string;
  readonly to: string;
  readonly data: Hex;
  readonly valueWei: bigint;
}

export interface RelayArbitrumSourceProof {
  readonly sourceChainId: 42161;
  readonly rpcOrigin: string;
  readonly deposit: Readonly<{ transactionHash: Hex; blockNumber: string; blockHash: Hex }>;
  readonly approval: Readonly<{ transactionHash: Hex; blockNumber: string; blockHash: Hex }> | null;
  readonly safeHead: Readonly<{ number: string; hash: Hex }>;
  readonly proofClass: "canonical_safe_source_receipts";
  readonly destinationDeliveryProven: false;
  readonly causalLinkCryptographicallyProven: false;
  readonly paidAcceptance: false;
}

/** Each invocation has one shared 24-POST guard; each effect consumes at most two read-only batches. */
export class RelayArbitrumSourceFinalityObserver {
  private readonly rpc: Pick<HttpsBaseRpc, "batchCall">;
  constructor(private readonly url: string, private readonly state: StateStore,
    rpc?: Pick<HttpsBaseRpc, "batchCall">,
    private readonly guardFactory: () => EvmDirectRpcGuard = () => new EvmDirectRpcGuard(state)) {
    this.rpc = rpc ?? new HttpsBaseRpc(url);
  }

  async observe(deposit: RelayArbitrumExpectedEffect,
    approval?: RelayArbitrumExpectedEffect): Promise<RelayArbitrumSourceProof | null> {
    validateExpected(deposit);
    if (approval !== undefined) validateExpected(approval);
    const guard = this.guardFactory();
    const approved = approval === undefined ? null : await this.effect(approval, guard);
    if (approval !== undefined && approved === null) return null;
    const deposited = await this.effect(deposit, guard);
    if (deposited === null) return null;
    return { sourceChainId: 42161, rpcOrigin: new URL(this.url).origin,
      deposit: deposited.effect, approval: approved?.effect ?? null, safeHead: deposited.safeHead,
      proofClass: "canonical_safe_source_receipts", destinationDeliveryProven: false,
      causalLinkCryptographicallyProven: false, paidAcceptance: false };
  }

  private async batch(guard: EvmDirectRpcGuard, calls: readonly ReadOnlyRpcBatchCall[]): Promise<readonly unknown[]> {
    const results = await guard.post(this.url, () => this.rpc.batchCall(calls));
    if (!Array.isArray(results) || results.length !== calls.length) invalid("batch_shape");
    return results;
  }

  private async effect(expected: RelayArbitrumExpectedEffect, guard: EvmDirectRpcGuard) {
    const [chain, rawTx, rawReceipt, rawSafe] = await this.batch(guard, [
      { method: "eth_chainId", params: [] },
      { method: "eth_getTransactionByHash", params: [expected.transactionHash] },
      { method: "eth_getTransactionReceipt", params: [expected.transactionHash] },
      { method: "eth_getBlockByNumber", params: ["safe", false] },
    ]);
    if (evmRpcQuantity(chain) !== 42161n) throw new ApnError("APN_CHAIN_MISMATCH", "Relay source RPC is not Arbitrum One.");
    if (rawTx === null || rawReceipt === null || rawSafe === null) return null;
    const tx = evmRpcRecord(rawTx), receipt = evmRpcRecord(rawReceipt);
    const safe = evmRpcBlockResult(rawSafe, "safe");
    const blockNumber = evmRpcQuantity(receipt.blockNumber);
    if (BigInt(safe.number) < blockNumber) return null;
    const blockTag = `0x${blockNumber.toString(16)}`;
    const [rawBlock, rawSafeAgain, rawTxAgain, rawReceiptAgain] = await this.batch(guard, [
      { method: "eth_getBlockByNumber", params: [blockTag, false] },
      { method: "eth_getBlockByNumber", params: [safe.tag, false] },
      { method: "eth_getTransactionByHash", params: [expected.transactionHash] },
      { method: "eth_getTransactionReceipt", params: [expected.transactionHash] },
    ]);
    if (rawBlock === null || rawSafeAgain === null || rawTxAgain === null || rawReceiptAgain === null) return null;
    const block = evmRpcBlockResult(rawBlock, blockTag);
    const safeAgain = evmRpcBlockResult(rawSafeAgain, safe.tag);
    if (!same(safe.hash, safeAgain.hash)) return null;
    const txAgain = evmRpcRecord(rawTxAgain), receiptAgain = evmRpcRecord(rawReceiptAgain);
    const txHash = evmRpcHex(tx.hash, 32), receiptHash = evmRpcHex(receipt.transactionHash, 32);
    const includedHash = evmRpcHex(tx.blockHash, 32), receiptBlockHash = evmRpcHex(receipt.blockHash, 32);
    if (!same(txHash, expected.transactionHash) || !same(receiptHash, expected.transactionHash) ||
      !same(evmRpcHex(txAgain.hash, 32), txHash) || !same(evmRpcHex(receiptAgain.transactionHash, 32), receiptHash))
      invalid("transaction_hash");
    if (!same(includedHash, block.hash) || !same(receiptBlockHash, block.hash) ||
      !same(evmRpcHex(txAgain.blockHash, 32), block.hash) ||
      !same(evmRpcHex(receiptAgain.blockHash, 32), block.hash) ||
      evmRpcQuantity(tx.blockNumber) !== blockNumber || evmRpcQuantity(txAgain.blockNumber) !== blockNumber ||
      evmRpcQuantity(receiptAgain.blockNumber) !== blockNumber) return null;
    for (const observed of [tx, txAgain]) {
      if (evmRpcQuantity(observed.chainId) !== 42161n ||
        !same(evmRpcAddress(observed.from), expected.from) ||
        observed.to === null || !same(evmRpcAddress(observed.to), expected.to) ||
        !same(evmRpcHex(observed.input), expected.data) ||
        evmRpcQuantity(observed.value) !== expected.valueWei) invalid("transaction_envelope");
    }
    const status = evmRpcQuantity(receipt.status), statusAgain = evmRpcQuantity(receiptAgain.status);
    if ((status !== 0n && status !== 1n) || (statusAgain !== 0n && statusAgain !== 1n)) invalid("receipt_status");
    if (status !== 1n || statusAgain !== 1n) return null;
    return { effect: { transactionHash: txHash, blockNumber: blockNumber.toString(), blockHash: block.hash },
      safeHead: { number: safe.number, hash: safe.hash } };
  }
}

function validateExpected(effect: RelayArbitrumExpectedEffect): void {
  if (!HASH.test(effect.transactionHash) || !/^0x[0-9a-fA-F]{40}$/u.test(effect.from) ||
    !/^0x[0-9a-fA-F]{40}$/u.test(effect.to) || !/^0x(?:[0-9a-fA-F]{2})+$/u.test(effect.data) ||
    effect.valueWei < 0n) throw new ApnError("APN_INVALID_INPUT", "Relay source effect expectation is invalid.");
}
