import { hashObject } from "./canonical.js";
import type { CommandRequest } from "./commands.js";
import { APPROVAL_WINDOW_MS, STATE_VERSION } from "./constants.js";
import { ApnError } from "./errors.js";
import { DirectAllowlistGate } from "./direct-allowlist-gate.js";
import { EVM_NETWORKS, evmAmount, evmDecimals, evmUint, type EvmAssetSelection, type EvmChainId } from "./evm-asset.js";
import { directEvmListRows, directEvmNetwork, type DirectEvmChainId } from "./evm-direct-networks.js";
import { listedEvmAsset } from "./evm-direct-allowlist.js";
import { evmDirectFingerprint, evmTransaction, requireEvmFunding, requireEvmRpc, type EvmDirectBinding } from "./evm-direct.js";
import type { OperationRecord } from "./model.js";
import type { OperationService } from "./operation-service.js";
import type { FeeEstimate } from "./ports.js";
import type { RuntimeContext } from "./runtime.js";
import { appendTransition, sealOperation } from "./state-integrity.js";
import { canonicalIdempotencyKey, publicOperation, validateEconomics } from "./transfer-policy.js";
import { canonicalAddress, canonicalProfile } from "./wallet-policy.js";
import { assertLocalNetworkProfile } from "./x402-network.js";
import { walletCustodyLock } from "./encrypted-wallet-store.js";
import { occupiedUniswapTokenNonces } from "./swap/uniswap-v3/token-nonce-ownership.js";

/** The shared networks keep their existing profile rule; a direct-only network is local-wallet only. */
export async function assertDirectEvmProfile(context: RuntimeContext, profile: string, chainId: DirectEvmChainId | undefined): Promise<void> {
  if (chainId === undefined || isSharedEvmChain(chainId)) return await assertLocalNetworkProfile(context, profile, chainId);
  const provider = await context.profileRepository?.load(context.state.profileHash(canonicalProfile(profile)));
  if (provider !== undefined && provider !== null && provider.provider_id !== "local") {
    throw new ApnError("APN_PROVIDER_UNAVAILABLE", "Direct transfers on this network use only a local wallet profile.");
  }
}

function isSharedEvmChain(chainId: DirectEvmChainId): chainId is EvmChainId {
  return EVM_NETWORKS.some((network) => network.chainId === chainId);
}

export async function prepareEvmTransfer(
  context: RuntimeContext,
  operations: OperationService,
  request: Extract<CommandRequest, { command: "transfer.prepare" }>,
  persist: (operation: OperationRecord) => Promise<void>,
): Promise<unknown> {
  if (request.asset === undefined) throw new ApnError("APN_INVALID_INPUT", "Explicit asset selection is missing.");
  // The frozen list is checked first: an unlisted network or an unpinned contract is refused before any RPC or custody call.
  const listed = listedEvmAsset(request.asset.chainId, request.asset.token,
    request.asset.decimals === undefined ? undefined : evmDecimals(request.asset.decimals));
  const selection: EvmAssetSelection = listed.selection;
  if (request.batchRpcReads && !(((selection.chainId === 59144 || selection.chainId === 56) && selection.token === "native") ||
      ((selection.chainId === 130 || selection.chainId === 137) &&
        (selection.chainId === 130 && selection.token === "native" || directEvmListRows(selection.chainId).some((row) =>
          row.kind === "token" && row.symbol === "USDC" && row.identifier === selection.token && row.decimals === 6))))) {
    throw new ApnError("APN_INVALID_INPUT", "Batched prepare reads require BNB or Linea native, Unichain native or USDC, or Polygon USDC.");
  }
  const maximumFeeWei = evmUint(request.maxFeeWei, true).toString();
  const priorityFeeWei = request.priorityFeeWei === undefined ? undefined : evmUint(request.priorityFeeWei).toString();
  if (priorityFeeWei !== undefined && directEvmNetwork(selection.chainId).feeModel === "arbitrum-inclusive") {
    throw new ApnError("APN_INVALID_INPUT", "Arbitrum One prices gas without a separate priority fee; omit --priority-fee-wei.",
      { reason: "priority_fee_not_applicable" });
  }
  const profile = canonicalProfile(request.profile), recipient = canonicalAddress(request.recipient);
  const idempotencyKey = canonicalIdempotencyKey(request.idempotencyKey);
  if (typeof request.amount !== "string" || request.amount.length > 335 || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/u.test(request.amount) || request.amount === "0") {
    throw new ApnError("APN_INVALID_INPUT", "Transfer amount must be a canonical positive decimal string.");
  }
  await context.ready();
  const state = context.state, profileHash = state.profileHash(profile);
  const operationId = state.operationId(profile, idempotencyKey), idempotencyHash = state.idempotencyHash(idempotencyKey);
  // A request without an owner tip hashes exactly as before, so existing idempotency keys keep resolving.
  const requestHash = hashObject({ method: "pay.transfer.evm.v1", profile, recipient, selection, amount: request.amount, maxFeeWei: maximumFeeWei,
    ...(priorityFeeWei === undefined ? {} : { priorityFeeWei }) });
  return await state.withLocks([`profile:${profileHash}`, `operation:${operationId}`, `operation:idempotency:${idempotencyHash}`], async () => {
    const existing = await operations.resolvePrepare({ kind: "direct_transfer", profileHash, operationId, idempotencyHash, requestHash });
    if (existing !== null) return publicOperation(existing.record as OperationRecord);
    return await state.withLocks([walletCustodyLock(state, profile)], async () => {
    const wallet = await state.loadWallet(profileHash);
    if (wallet === null) throw new ApnError("APN_OPERATION_BLOCKED", "Wallet is not initialized.");
    await operations.assertEvmAccountAvailable(profileHash, selection.chainId, wallet.address);
    const amount = evmAmount(request.amount, listed.decimals);
    // Owner caps come only from the active allowlist policy and the shared usage ledger; no policy means no transfer.
    const allowlist = await new DirectAllowlistGate(context).admit({ profile, operationId, family: "evm", account: wallet.address,
      chain: `eip155:${selection.chainId}`, amountAtomic: amount.atomic,
      asset: selection.token === "native" ? { kind: "native", identifier: null } : { kind: "token", identifier: selection.token } });
    const rpcPort = context.requireRpc();
    if (selection.chainId === 56) rpcPort.armBnbDirectRpcGuard?.();
    const rpc = requireEvmRpc(rpcPort);
    const grouped = request.batchRpcReads || selection.chainId === 56 ? (selection.chainId === 56 ? rpc.prepareBnbNative?.() : selection.chainId === 130
      ? (selection.token === "native" ? rpc.prepareUnichainNative?.() : rpc.prepareUnichainUsdc?.())
      : selection.chainId === 137 ? rpc.preparePolygonUsdc?.() : rpc.prepareLineaNative?.()) : undefined;
    if ((request.batchRpcReads || selection.chainId === 56) && grouped === undefined) throw new ApnError("APN_RPC_CONFIG", "Selected RPC does not support batched prepare reads.");
    const balance = await (grouped ?? rpc).balance(wallet.address, { ...selection, decimals: listed.decimals });
    if (balance.address !== wallet.address || balance.asset.chainId !== selection.chainId || balance.asset.decimals !== listed.decimals ||
        (selection.token === "native" ? balance.asset.kind !== "native" : balance.asset.address !== selection.token)) {
      throw new ApnError("APN_ASSET_MISMATCH", "Balance does not belong to the exact selected wallet, network and asset.");
    }
    // An amount above the balance is an economic refusal before any gas estimate, which would fail on the same shortfall.
    if (evmUint(balance.assetAtomic) < BigInt(amount.atomic)) throw new ApnError("APN_INSUFFICIENT_ASSET", "Selected asset balance is insufficient for the exact amount.");
    const transaction = evmTransaction(balance.asset, wallet.address, recipient, amount.atomic);
    const { nonce: rpcNonce, estimated } = grouped === undefined
      ? await Promise.all([rpc.nonce(selection.chainId, wallet.address, "pending"), rpc.estimate(transaction)]).then(([nonce, fee]) => ({ nonce, estimated: fee }))
      : await grouped.nonceEstimate(wallet.address, transaction);
    let nonce = BigInt(rpcNonce); if (selection.chainId === 1) { const owned = new Set((await occupiedUniswapTokenNonces(state.root, wallet.address)).map(String));
      while (owned.has(nonce.toString())) nonce += 1n; }
    const economics = validateEconomics(nonce.toString(), priorityFeeWei === undefined ? estimated : withOwnerPriorityFee(estimated, priorityFeeWei));
    const quote = grouped === undefined ? await rpc.feeQuote(selection.chainId, economics) : await grouped.feeQuote(economics);
    requireEvmFunding(balance, amount.atomic, quote, maximumFeeWei);
    const preparedAt = new Date(Math.floor(context.clock.now().getTime() / 1000) * 1000).toISOString();
    const expiresAt = new Date(Date.parse(preparedAt) + APPROVAL_WINDOW_MS).toISOString();
    const binding: EvmDirectBinding = {
      schemaVersion: "apn.evm-direct.v1", asset: balance.asset, transactionTo: transaction.to,
      valueAtomic: transaction.valueAtomic, maxFeeWei: maximumFeeWei, feeQuote: quote,
    };
    const frozen = {
      operationId, profile, chainId: selection.chainId, token: balance.asset.address, walletAddress: wallet.address,
      recipient, amountAtomic: amount.atomic, transactionData: transaction.data, economics, preparedAt, expiresAt, evm: binding, allowlist,
    };
    const initial = { at: preparedAt, state: "awaiting_approval" as const, terminal: false, reason: "prepared_and_frozen", proofClass: "durable_pre_effect" };
    const operation = sealOperation({
      schemaVersion: STATE_VERSION, ...frozen, profileHash, idempotencyHash, requestHash, fingerprint: evmDirectFingerprint(frozen),
      amountDecimal: amount.decimal, preparedBlockNumberAtomic: balance.blockNumberAtomic,
      state: initial.state, terminal: false, reason: initial.reason, proofClass: initial.proofClass, transitions: appendTransition([], initial),
    });
    await persist(operation);
    return publicOperation(operation);
    });
  });
}

/** The owner's tip replaces the RPC suggestion; the fee cap keeps its headroom of twice the base fee, plus that tip. */
function withOwnerPriorityFee(fees: FeeEstimate, priorityFeeWei: string): FeeEstimate {
  const baseFeeTwice = BigInt(fees.maxFeePerGasAtomic) - BigInt(fees.maxPriorityFeePerGasAtomic);
  if (baseFeeTwice < 0n) throw new ApnError("APN_RPC_PROTOCOL", "The RPC fee estimate has a priority fee above its fee cap.");
  const maximum = baseFeeTwice + BigInt(priorityFeeWei);
  if (maximum === 0n) {
    throw new ApnError("APN_INVALID_INPUT", "A zero total gas price is never signed; set a positive --priority-fee-wei on a zero-base-fee network.",
      { reason: "zero_gas_price" });
  }
  return { ...fees, maxFeePerGasAtomic: maximum.toString(), maxPriorityFeePerGasAtomic: priorityFeeWei };
}
