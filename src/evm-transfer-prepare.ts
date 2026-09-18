import { hashObject } from "./canonical.js";
import type { CommandRequest } from "./commands.js";
import { APPROVAL_WINDOW_MS, STATE_VERSION } from "./constants.js";
import { ApnError } from "./errors.js";
import { DirectAllowlistGate } from "./direct-allowlist-gate.js";
import { evmAmount, evmDecimals, evmUint, type EvmAssetSelection } from "./evm-asset.js";
import { listedEvmAsset } from "./evm-direct-allowlist.js";
import { evmDirectFingerprint, evmTransaction, requireEvmFunding, requireEvmRpc, type EvmDirectBinding } from "./evm-direct.js";
import type { OperationRecord } from "./model.js";
import type { OperationService } from "./operation-service.js";
import type { RuntimeContext } from "./runtime.js";
import { appendTransition, sealOperation } from "./state-integrity.js";
import { canonicalIdempotencyKey, publicOperation, validateEconomics } from "./transfer-policy.js";
import { canonicalAddress, canonicalProfile } from "./wallet-policy.js";

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
  const maximumFeeWei = evmUint(request.maxFeeWei, true).toString();
  const profile = canonicalProfile(request.profile), recipient = canonicalAddress(request.recipient);
  const idempotencyKey = canonicalIdempotencyKey(request.idempotencyKey);
  if (typeof request.amount !== "string" || request.amount.length > 335 || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/u.test(request.amount) || request.amount === "0") {
    throw new ApnError("APN_INVALID_INPUT", "Transfer amount must be a canonical positive decimal string.");
  }
  await context.ready();
  const state = context.state, profileHash = state.profileHash(profile);
  const operationId = state.operationId(profile, idempotencyKey), idempotencyHash = state.idempotencyHash(idempotencyKey);
  const requestHash = hashObject({ method: "pay.transfer.evm.v1", profile, recipient, selection, amount: request.amount, maxFeeWei: maximumFeeWei });
  return await state.withLocks([`profile:${profileHash}`, `operation:${operationId}`, `operation:idempotency:${idempotencyHash}`], async () => {
    const existing = await operations.resolvePrepare({ kind: "direct_transfer", profileHash, operationId, idempotencyHash, requestHash });
    if (existing !== null) return publicOperation(existing.record as OperationRecord);
    const wallet = await state.loadWallet(profileHash);
    if (wallet === null) throw new ApnError("APN_OPERATION_BLOCKED", "Wallet is not initialized.");
    await operations.assertEvmAccountAvailable(profileHash, selection.chainId, wallet.address);
    const amount = evmAmount(request.amount, listed.decimals);
    // Owner caps come only from the active allowlist policy and the shared usage ledger; no policy means no transfer.
    const allowlist = await new DirectAllowlistGate(context).admit({ profile, operationId, family: "evm", account: wallet.address,
      chain: `eip155:${selection.chainId}`, amountAtomic: amount.atomic,
      asset: selection.token === "native" ? { kind: "native", identifier: null } : { kind: "token", identifier: selection.token } });
    const rpc = requireEvmRpc(context.requireRpc());
    const balance = await rpc.balance(wallet.address, { ...selection, decimals: listed.decimals });
    if (balance.address !== wallet.address || balance.asset.chainId !== selection.chainId || balance.asset.decimals !== listed.decimals ||
        (selection.token === "native" ? balance.asset.kind !== "native" : balance.asset.address !== selection.token)) {
      throw new ApnError("APN_ASSET_MISMATCH", "Balance does not belong to the exact selected wallet, network and asset.");
    }
    const transaction = evmTransaction(balance.asset, wallet.address, recipient, amount.atomic);
    const [nonce, fees] = await Promise.all([rpc.nonce(selection.chainId, wallet.address, "pending"), rpc.estimate(transaction)]);
    const economics = validateEconomics(nonce, fees);
    const quote = await rpc.feeQuote(selection.chainId, economics);
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
}
