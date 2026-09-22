import { encodeFunctionData, getAddress, keccak256, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson, domainHash } from "../../canonical.js";
import { EncryptedWalletStore } from "../../encrypted-wallet-store.js";
import { ApnError } from "../../errors.js";
import type { EvmRpcCall } from "../../evm-ports.js";
import { evmRpcHex, evmRpcQuantity } from "../../evm-rpc-codec.js";
import type { WrappingSecretPort } from "../../macos-keychain.js";
import type { StateStore } from "../../state.js";
import { UniswapTokenEffectJournal } from "./token-effects.js";
import type { TokenEffectKind, TokenSealedEffect } from "./token-execution.js";
import { UniswapTokenJournal, type TokenGasEnvelope, type UniswapTokenOperation } from "./token-operation.js";
import { encodeUniswapTokenApproval } from "./token-route.js";
import { UniswapTokenNonceStore } from "./token-nonce.js";

const ERC20 = parseAbi(["function allowance(address owner,address spender) view returns (uint256)"]);
export interface TokenTransactionEnvelope { readonly chainId: 1; readonly from: string; readonly to: string; readonly data: Hex;
  readonly value: "0"; readonly nonce: string; readonly gasLimit: string; readonly maxFeePerGas: string; readonly maxPriorityFeePerGas: string }

/** Local encrypted-wallet custody plus the durable one-way broadcast boundary. */
export class UniswapTokenCustody {
  private readonly wallets: EncryptedWalletStore;
  private readonly effects: UniswapTokenEffectJournal;
  private readonly nonces: UniswapTokenNonceStore;
  private readonly operations: UniswapTokenJournal;
  constructor(private readonly state: StateStore, wrapping: WrappingSecretPort, private readonly call: EvmRpcCall,
    private readonly now: () => Date) { this.wallets = new EncryptedWalletStore(state, wrapping); this.effects = new UniswapTokenEffectJournal(state.root);
    this.nonces = new UniswapTokenNonceStore(state.root); this.operations = new UniswapTokenJournal(state.root); }

  async withAccountLock<T>(account: string, work: () => Promise<T>): Promise<T> {
    return await this.state.withLocks([`uniswap-token-account:${domainHash("apn.uniswap-token-account-lock.v1", account)}`], work);
  }
  async allocateNonce(op: UniswapTokenOperation, kind: TokenEffectKind) {
    const pending = evmRpcQuantity(await this.call("eth_getTransactionCount", [op.account, "pending"]));
    return await this.nonces.allocate(op, kind, pending, async (operationId, effectKind) => await this.hasDurableEffect(operationId, effectKind));
  }
  async releaseNonce(op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string) {
    await this.nonces.release(op, kind, nonce, async (operationId, effectKind) => await this.hasDurableEffect(operationId, effectKind));
  }
  async commitNonce(op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string) { await this.nonces.commit(op, kind, nonce); }
  private async hasDurableEffect(operationId: string, kind: TokenEffectKind) {
    const op = await this.operations.load(operationId); if (op === null) return false;
    const attempt = kind === "approval" ? op.approvalAttempt : kind === "swap" ? op.swapAttempt : op.cleanupAttempt;
    return attempt?.transactionHash !== null && attempt?.transactionHash !== undefined || await this.effects.load(op, kind) !== null;
  }
  async currentAllowance(op: UniswapTokenOperation) {
    const data = encodeFunctionData({ abi: ERC20, functionName: "allowance", args: [op.account as Hex, op.route.router] });
    return BigInt(evmRpcHex(await this.call("eth_call", [{ to: op.route.inputToken, data }, "latest"]), 32)).toString();
  }
  async seal(op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<TokenSealedEffect> {
    return await this.state.withLocks([`uniswap-token-custody:${op.operationId}:${kind}`], async () => await this.sealUnlocked(op, kind, nonce));
  }
  private async sealUnlocked(op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): Promise<TokenSealedEffect> {
    const envelope = envelopeOf(op, kind, nonce), key = effectKey(op, kind), existing = await this.effects.load(op, kind);
    const wallet = await this.wallets.describe(op.profile);
    if (wallet === null) blocked("The encrypted EVM wallet is unavailable.", "uniswap_token_wallet_missing");
    try {
      if (wallet.identity.address !== op.account || getAddress(wallet.identity.address) !== op.account) throw new ApnError("APN_WALLET_MISMATCH", "Uniswap token signer changed.");
      const cached = wallet.secret.directEffects[key];
      if (existing !== null) {
        if (cached === undefined || cached.transactionHash !== existing.transactionHash || cached.payloadHash !== existing.envelopeHash) corrupt("Uniswap token signed effect is missing or changed.");
        return { transactionHash: existing.transactionHash, envelopeHash: existing.envelopeHash };
      }
      const account = privateKeyToAccount(wallet.secret.privateKey), n = BigInt(nonce);
      if (n > BigInt(Number.MAX_SAFE_INTEGER)) blocked("Uniswap token nonce exceeds signer bounds.", "uniswap_token_nonce_bound");
      const raw = await account.signTransaction({ type: "eip1559", chainId: 1, to: envelope.to as Hex, data: envelope.data,
        value: 0n, nonce: Number(n), gas: BigInt(envelope.gasLimit), maxFeePerGas: BigInt(envelope.maxFeePerGas),
        maxPriorityFeePerGas: BigInt(envelope.maxPriorityFeePerGas), accessList: [] });
      const transactionHash = keccak256(raw), envelopeHash = domainHash("apn.uniswap-token-envelope.v1", canonicalJson(envelope));
      wallet.secret.directEffects[key] = { payloadHash: envelopeHash, transactionHash, rawTransaction: raw, rawTransactionHash: transactionHash };
      await this.wallets.save(wallet.identity, wallet.secret);
      await this.effects.seal(op, kind, transactionHash, envelope, this.now());
      return { transactionHash, envelopeHash };
    } finally { this.wallets.clear(wallet.secret); }
  }
  async send(op: UniswapTokenOperation, kind: TokenEffectKind): Promise<"accepted" | "ambiguous"> {
    return await this.state.withLocks([`uniswap-token-custody:${op.operationId}:${kind}`], async () => await this.sendUnlocked(op, kind));
  }
  private async sendUnlocked(op: UniswapTokenOperation, kind: TokenEffectKind): Promise<"accepted" | "ambiguous"> {
    const effect = await this.effects.load(op, kind); if (effect === null || effect.phase !== "sealed") blocked("Uniswap token effect is unavailable or already attempted.", "uniswap_token_single_send");
    const wallet = await this.wallets.describe(op.profile); if (wallet === null) corrupt("Uniswap token wallet disappeared.");
    try {
      const material = wallet.secret.directEffects[effectKey(op, kind)];
      if (material === undefined || material.transactionHash !== effect.transactionHash || material.payloadHash !== effect.envelopeHash) corrupt("Uniswap token raw effect binding changed.");
      await this.effects.markStarted(op, kind, this.now());
      let accepted = false;
      try { accepted = evmRpcHex(await this.call("eth_sendRawTransaction", [material.rawTransaction]), 32) === effect.transactionHash; } catch { accepted = false; }
      try { await this.effects.markOutcome(op, kind, accepted ? "send_accepted" : "send_ambiguous", this.now()); } catch { /* send_started remains the no-resend boundary */ }
      return accepted ? "accepted" : "ambiguous";
    } finally { this.wallets.clear(wallet.secret); }
  }
}

export function envelopeOf(op: UniswapTokenOperation, kind: TokenEffectKind, nonce: string): TokenTransactionEnvelope {
  const gas: TokenGasEnvelope = kind === "approval" ? op.approvalGas : kind === "swap" ? op.swapGas : op.cleanupGas;
  const call = kind === "swap" ? { to: op.route.router, data: op.route.calldata } : encodeUniswapTokenApproval(op.route.inputToken, kind === "approval" ? op.route.amountIn : "0");
  return { chainId: 1, from: op.account, to: call.to, data: call.data, value: "0", nonce,
    gasLimit: gas.gasLimit, maxFeePerGas: gas.maxFeePerGas, maxPriorityFeePerGas: gas.maxPriorityFeePerGas };
}
function effectKey(op: UniswapTokenOperation, kind: TokenEffectKind) { return domainHash("apn.uniswap-token-wallet-effect.v1", canonicalJson({ operationId: op.operationId, kind })); }
function corrupt(message: string): never { throw new ApnError("APN_STATE_CORRUPT", message); }
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
