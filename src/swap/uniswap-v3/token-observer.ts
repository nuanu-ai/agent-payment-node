import { encodeFunctionData, parseAbi, type Hex } from "viem";
import { ApnError } from "../../errors.js";
import type { EvmRpcCall } from "../../evm-ports.js";
import { evmRpcAddress, evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../../evm-rpc-codec.js";
import type { TokenEffectKind, TokenEffectObservation } from "./token-execution.js";
import type { UniswapTokenOperation } from "./token-operation.js";
import { envelopeOf } from "./token-custody.js";
import { tokenBatch, type TokenRpcCall } from "./token-rpc.js";

const ERC20 = parseAbi(["function allowance(address owner,address spender) view returns (uint256)"]);
export class UniswapTokenObserver {
  constructor(private readonly call: EvmRpcCall) {}
  async observe(op: UniswapTokenOperation, kind: TokenEffectKind, transactionHash: string): Promise<TokenEffectObservation | null> {
    const rpc = this.call as TokenRpcCall;
    const [primary, receiptRows] = await Promise.all([
      tokenBatch(rpc, "primary", [{ method: "eth_chainId", params: [], cachePolicy: "immutable" },
        { method: "eth_getTransactionByHash", params: [transactionHash], cachePolicy: "none" }]),
      tokenBatch(rpc, "receipt", [{ method: "eth_chainId", params: [], cachePolicy: "immutable" },
        { method: "eth_getTransactionReceipt", params: [transactionHash], cachePolicy: "none" }]),
    ]);
    if (evmRpcQuantity(primary[0]) !== 1n || evmRpcQuantity(receiptRows[0]) !== 1n) throw new ApnError("APN_CHAIN_MISMATCH", "Uniswap token observer requires Ethereum chain 1.");
    const rawTx = primary[1], rawReceipt = receiptRows[1];
    if (rawTx === null && rawReceipt === null) return null;
    if (rawTx === null || rawReceipt === null) { if (rawReceipt === null) return null; blocked("Receipt exists without its transaction.", "uniswap_token_receipt_conflict"); }
    const tx = evmRpcRecord(rawTx), receipt = evmRpcRecord(rawReceipt), hash = evmRpcHex(transactionHash, 32), attempt = kind === "approval" ? op.approvalAttempt : kind === "swap" ? op.swapAttempt : op.cleanupAttempt;
    if (attempt === null) corrupt("Uniswap token observation has no attempt.");
    if (evmRpcHex(tx.hash, 32) !== hash || evmRpcHex(receipt.transactionHash, 32) !== hash) blocked("Transaction hash evidence conflicts.", "uniswap_token_transaction_conflict");
    const envelope = envelopeOf(op, kind, attempt.nonce), blockNumber = evmRpcQuantity(receipt.blockNumber), txBlock = evmRpcQuantity(tx.blockNumber),
      blockHash = evmRpcHex(receipt.blockHash, 32);
    if (blockNumber !== txBlock || evmRpcHex(tx.blockHash, 32) !== blockHash || blockNumber === 0n) blocked("Transaction block evidence conflicts.", "uniswap_token_reorg_conflict");
    assertEnvelope(tx, envelope);
    if (evmRpcAddress(receipt.from) !== op.account || evmRpcAddress(receipt.to) !== envelope.to) blocked("Receipt sender or target conflicts.", "uniswap_token_receipt_conflict");
    const [rawBlock, rawSafe] = await tokenBatch(rpc, "primary", [
      { method: "eth_getBlockByNumber", params: [`0x${blockNumber.toString(16)}`, false], cachePolicy: "none" },
      { method: "eth_getBlockByNumber", params: ["safe", false], cachePolicy: "none" },
    ]), block = decodedBlock(rawBlock), safe = decodedBlock(rawSafe);
    if (block.hash !== blockHash) blocked("Receipt block is no longer canonical.", "uniswap_token_reorg_conflict");
    if (BigInt(safe.number) < blockNumber) return null;
    await recheck(rpc, block, safe);
    const status = evmRpcQuantity(receipt.status), gasUsed = evmRpcQuantity(receipt.gasUsed), effectivePrice = evmRpcQuantity(receipt.effectiveGasPrice),
      cap = kind === "approval" ? op.approvalGas : kind === "swap" ? op.swapGas : op.cleanupGas;
    if (gasUsed > BigInt(cap.gasLimit) || effectivePrice > BigInt(cap.maxFeePerGas)) blocked("Actual network fee exceeds its effect cap.", "uniswap_token_gas_cap");
    const tag = block.tag, gasDebitWei = (gasUsed * effectivePrice).toString();
    if (status === 0n || kind !== "swap") {
      const [rawAllowance] = await tokenBatch(rpc, "archive", [allowanceRequest(op, tag)]), allowance = BigInt(evmRpcHex(rawAllowance, 32));
      await recheck(rpc, block, safe);
      if (status === 0n) return { status: "reverted", transactionHash: hash, gasDebitWei, allowanceAtomic: allowance.toString() };
      if (status !== 1n) blocked("Receipt status is invalid.", "uniswap_token_receipt_conflict");
      return { status: "success", transactionHash: hash, gasDebitWei, allowanceAtomic: allowance.toString() };
    }
    if (status !== 1n) blocked("Receipt status is invalid.", "uniswap_token_receipt_conflict");
    const before = `0x${(blockNumber - 1n).toString(16)}` as Hex;
    const [first, second] = await Promise.all([
      tokenBatch(rpc, "archive", [allowanceRequest(op, tag), balanceRequest(op.route.inputToken, op.account, before), balanceRequest(op.route.inputToken, op.account, tag)]),
      tokenBatch(rpc, "archive", [balanceRequest(op.route.outputToken, op.route.recipient, before), balanceRequest(op.route.outputToken, op.route.recipient, tag)]),
    ]), allowance = BigInt(evmRpcHex(first[0], 32)), inputBefore = BigInt(evmRpcHex(first[1], 32)), inputAfter = BigInt(evmRpcHex(first[2], 32)),
      outputBefore = BigInt(evmRpcHex(second[0], 32)), outputAfter = BigInt(evmRpcHex(second[1], 32));
    await recheck(rpc, block, safe);
    if (inputAfter > inputBefore || outputAfter < outputBefore) blocked("Token balance evidence is inconsistent.", "uniswap_token_balance_conflict");
    return { status: "success", transactionHash: hash, gasDebitWei, allowanceAtomic: allowance.toString(),
      inputDebitAtomic: (inputBefore - inputAfter).toString(), outputCreditAtomic: (outputAfter - outputBefore).toString() };
  }
}
function allowanceRequest(op: UniswapTokenOperation, tag: Hex) { const data = encodeFunctionData({ abi: ERC20, functionName: "allowance", args: [op.account as Hex, op.route.router] });
  return { method: "eth_call", params: [{ to: op.route.inputToken, data }, tag], cachePolicy: "none" as const }; }
function balanceRequest(token: string, account: string, tag: Hex) { return { method: "eth_call",
  params: [{ to: token, data: `0x70a08231${account.slice(2).toLowerCase().padStart(64, "0")}` }, tag], cachePolicy: "none" as const }; }
function decodedBlock(value: unknown) { const raw = evmRpcRecord(value), number = evmRpcQuantity(raw.number), hash = evmRpcHex(raw.hash, 32);
  return { tag: `0x${number.toString(16)}` as Hex, number: number.toString(), hash }; }
async function recheck(rpc: TokenRpcCall, block: ReturnType<typeof decodedBlock>, safe: ReturnType<typeof decodedBlock>) {
  const [a, b] = await tokenBatch(rpc, "primary", [
    { method: "eth_getBlockByNumber", params: [block.tag, false], cachePolicy: "none" },
    { method: "eth_getBlockByNumber", params: [safe.tag, false], cachePolicy: "none" },
  ]);
  if (decodedBlock(a).hash !== block.hash || decodedBlock(b).hash !== safe.hash) blocked("Receipt block changed during observation.", "uniswap_token_reorg_conflict");
}
function assertEnvelope(tx: Record<string, unknown>, envelope: ReturnType<typeof envelopeOf>) {
  if (evmRpcQuantity(tx.chainId) !== 1n || evmRpcAddress(tx.from) !== envelope.from || evmRpcAddress(tx.to) !== envelope.to ||
      evmRpcHex(tx.input) !== envelope.data.toLowerCase() || evmRpcQuantity(tx.value) !== 0n || evmRpcQuantity(tx.nonce).toString() !== envelope.nonce ||
      evmRpcQuantity(tx.gas).toString() !== envelope.gasLimit || evmRpcQuantity(tx.maxFeePerGas).toString() !== envelope.maxFeePerGas ||
      evmRpcQuantity(tx.maxPriorityFeePerGas).toString() !== envelope.maxPriorityFeePerGas || evmRpcQuantity(tx.type) !== 2n) {
    blocked("Mined transaction conflicts with the signed envelope.", "uniswap_token_transaction_conflict");
  }
}
function corrupt(message: string): never { throw new ApnError("APN_STATE_CORRUPT", message); }
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
