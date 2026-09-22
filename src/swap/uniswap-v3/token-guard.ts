import { encodeFunctionData, parseAbi, type Hex } from "viem";
import { EncryptedWalletStore } from "../../encrypted-wallet-store.js";
import { ApnError } from "../../errors.js";
import type { EvmRpcCall } from "../../evm-ports.js";
import { evmRpcHex, evmRpcQuantity, evmRpcRecord } from "../../evm-rpc-codec.js";
import type { WrappingSecretPort } from "../../macos-keychain.js";
import type { StateStore } from "../../state.js";
import type { TokenEffectKind } from "./token-execution.js";
import type { UniswapTokenMaterial } from "./token-material.js";
import type { UniswapTokenOperation } from "./token-operation.js";
import { encodeUniswapTokenApproval, verifyUniswapTokenRoutePins } from "./token-route.js";
import { UniswapTokenRevalidator } from "./token-revalidation.js";
import type { UniswapTokenUsage } from "./token-usage.js";
import { tokenBatch, type TokenRpcCall } from "./token-rpc.js";

const ERC20 = parseAbi(["function allowance(address owner,address spender) view returns (uint256)", "function balanceOf(address owner) view returns (uint256)"]);
export class UniswapTokenSigningGuard {
  private readonly wallets: EncryptedWalletStore;
  constructor(private readonly state: StateStore, wrapping: WrappingSecretPort, private readonly call: EvmRpcCall,
    private readonly usage: UniswapTokenUsage, private readonly now: () => Date,
    private readonly verifyPins: (call: EvmRpcCall, tag: Hex) => Promise<void> = verifyUniswapTokenRoutePins) { this.wallets = new EncryptedWalletStore(state, wrapping); }

  async confirm(material: UniswapTokenMaterial): Promise<void> {
    await this.usage.confirmMaterial(material); await this.wallet(material.profile, material.account);
    const at = this.now(); if (at.getTime() >= material.route.deadline * 1000) blocked("Token quote expired.", "uniswap_token_quote_expired");
    const block = await this.common(material.account, material.route.inputToken, material.route.router, material.route.deadline);
    const [rawAllowance, rawBalance] = await tokenBatch(this.call as TokenRpcCall, "archive", [
      request("allowance", material.account, material.route.inputToken, material.route.router, block.tag),
      request("balanceOf", material.account, material.route.inputToken, material.route.router, block.tag),
    ]);
    const allowance = word(rawAllowance);
    if (allowance !== 0n && allowance !== BigInt(material.route.amountIn)) blocked("Token allowance changed.", "uniswap_token_allowance_drift");
    if (word(rawBalance) < BigInt(material.route.amountIn)) blocked("Source token balance is below the exact input.", "uniswap_token_source_balance");
    const tx = allowance === 0n ? encodeUniswapTokenApproval(material.route.inputToken, material.route.amountIn) :
      { to: material.route.router, data: material.route.calldata };
    await simulate(this.call, { from: material.account, to: tx.to, data: tx.data, value: "0x0" }, block.tag,
      allowance === 0n ? material.approvalGas.gasLimit : material.swapGas.gasLimit, allowance === 0n);
    const gas = allowance === 0n ? material.approvalGas : material.swapGas;
    await finish(this.call, block, material.account, material.maximumNativeDebitWei, gas.maxFeePerGas, gas.maxPriorityFeePerGas);
  }

  async inspect(op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<void> {
    if (kind === "cleanup") await this.usage.confirmCleanup(op); else await this.usage.confirmReserved(op); await this.wallet(op.profile, op.account);
    if (kind !== "cleanup" && this.now().getTime() >= op.route.deadline * 1000) blocked("Token route expired before signing.", "uniswap_token_deadline");
    const gas = kind === "approval" ? op.approvalGas : kind === "swap" ? op.swapGas : op.cleanupGas;
    const block = await this.common(op.account, op.route.inputToken, op.route.router, op.route.deadline), pending = block.pending;
    if (BigInt(nonce) < pending) blocked("Reserved nonce is stale.", "uniswap_token_nonce_drift");
    const reads = [request("allowance", op.account, op.route.inputToken, op.route.router, block.tag),
      ...(kind === "cleanup" ? [] : [request("balanceOf", op.account, op.route.inputToken, op.route.router, block.tag)])];
    const values = await tokenBatch(this.call as TokenRpcCall, "archive", reads), allowance = word(values[0]);
    if (kind === "approval" && allowance !== 0n || kind === "swap" && allowance !== BigInt(op.route.amountIn) || kind === "cleanup" && allowance === 0n) {
      blocked("Token allowance changed before signing.", "uniswap_token_allowance_drift");
    }
    if (kind !== "cleanup" && word(values[1]) < BigInt(op.route.amountIn)) blocked("Source token balance is below the exact input.", "uniswap_token_source_balance");
    if (kind === "swap") await new UniswapTokenRevalidator(this.call, this.verifyPins).revalidate(op);
    else { const approval = encodeUniswapTokenApproval(op.route.inputToken, kind === "approval" ? op.route.amountIn : "0");
      await simulate(this.call, { from: op.account, to: approval.to, data: approval.data, value: "0x0" }, block.tag, gas.gasLimit, true); }
    await finish(this.call, block, op.account, (BigInt(op.maximumNativeDebitWei) - BigInt(op.accumulatedNativeDebitWei)).toString(), gas.maxFeePerGas, gas.maxPriorityFeePerGas);
  }

  private async common(account: string, token: string, router: string, deadline: number) {
    const [chain, rawBlock, rawPending] = await tokenBatch(this.call as TokenRpcCall, "primary", [
      { method: "eth_chainId", params: [], cachePolicy: "immutable" },
      { method: "eth_getBlockByNumber", params: ["latest", false], cachePolicy: "none" },
      { method: "eth_getTransactionCount", params: [account, "pending"], cachePolicy: "none" },
    ]);
    if (evmRpcQuantity(chain) !== 1n) throw new ApnError("APN_CHAIN_MISMATCH", "Uniswap token signing requires Ethereum chain 1.");
    const block = decodedBlock(rawBlock), pending = evmRpcQuantity(rawPending); await this.verifyPins(this.call, block.tag);
    if (router === token || !Number.isSafeInteger(deadline)) corrupt("Uniswap token signing material changed.");
    return { ...block, pending };
  }
  private async wallet(profile: string, account: string) { const wallet = await this.wallets.describe(profile);
    if (wallet === null || wallet.identity.address !== account) blocked("The admitted encrypted wallet changed.", "uniswap_token_wallet_drift");
    this.wallets.clear(wallet.secret); }
}
function request(kind: "allowance" | "balanceOf", owner: string, token: string, router: string, tag: Hex) { const data = encodeFunctionData({ abi: ERC20,
  functionName: kind, args: kind === "allowance" ? [owner as Hex, router as Hex] : [owner as Hex] });
  return { method: "eth_call", params: [{ to: token, data }, tag], cachePolicy: "snapshot" as const }; }
function word(value: unknown) { return BigInt(evmRpcHex(value, 32)); }
function decodedBlock(value: unknown) { const raw = evmRpcRecord(value), number = evmRpcQuantity(raw.number), hash = evmRpcHex(raw.hash, 32);
  return { tag: `0x${number.toString(16)}` as Hex, number: number.toString(), hash, raw }; }
async function simulate(call: EvmRpcCall, tx: object, tag: Hex, limit: string, noReturn: boolean) { const result = evmRpcHex(await call("eth_call", [tx, tag]));
  if (noReturn && result !== "0x" && result !== `0x${"0".repeat(63)}1`) blocked("Token approval simulation returned an unsafe result.", "uniswap_token_approval_simulation");
  if (evmRpcQuantity(await call("eth_estimateGas", [tx, tag])) > BigInt(limit)) blocked("Token transaction gas exceeds its cap.", "uniswap_token_gas_cap"); }
async function finish(call: EvmRpcCall, block: ReturnType<typeof decodedBlock>, account: string, nativeCap: string, maxFee: string, maxPriority: string) {
  const [rawNative, rawPriority, rawBlock] = await tokenBatch(call as TokenRpcCall, "primary", [
    { method: "eth_getBalance", params: [account, block.tag], cachePolicy: "snapshot" },
    { method: "eth_maxPriorityFeePerGas", params: [], cachePolicy: "none" },
    { method: "eth_getBlockByNumber", params: [block.tag, false], cachePolicy: "none" },
  ]), base = evmRpcQuantity(block.raw.baseFeePerGas), priority = evmRpcQuantity(rawPriority);
  if (evmRpcQuantity(rawNative) < BigInt(nativeCap)) blocked("Native fee balance is below the approved bound.", "uniswap_token_native_balance");
  if (decodedBlock(rawBlock).hash !== block.hash) throw new ApnError("APN_RPC_PROTOCOL", "EVM block changed around pinned reads.");
  if (priority > BigInt(maxPriority) || base * 2n + priority > BigInt(maxFee)) {
    blocked("Current EIP-1559 fees exceed the approved caps.", "uniswap_token_fee_cap"); } }
function corrupt(message: string): never { throw new ApnError("APN_STATE_CORRUPT", message); }
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
