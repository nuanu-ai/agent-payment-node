import { ApnError } from "../../errors.js";
import { evmAddressLock } from "../../evm-address-ownership.js";
import type { StateStore } from "../../state.js";
import { mmDispatchIntent } from "../dispatch.js";
import type { MetaMaskGaslessOperationRecord } from "../operation-model.js";
import { metaMaskGaslessOwner } from "../owner.js";
import type { MetaMaskGaslessRpcFactory } from "../ports.js";
import { mmDisableCall } from "./call.js";
import { mmRevocationPayload } from "./chain.js";
import { metaMaskRevocationSummary, type MetaMaskRevocationApprovalPort } from "./consent.js";
import { metaMaskRevocationUnsentCause, type MetaMaskRevocationUnsentCause, type MetaMaskRevocationWalletPort } from "./wallet.js";

/** The states in which a dispatched delegation may still be redeemable and nothing proves its outcome. */
const REVOCABLE = ["submitted_pending", "unknown_finality", "failed_effects_pending", "abandoned_unknown"] as const;

export interface MetaMaskRevocationDependencies {
  readonly approval?: MetaMaskRevocationApprovalPort;
  readonly wallet?: MetaMaskRevocationWalletPort;
}

/**
 * The owner's exit for a disclosed delegation whose outcome no proof decides: one `disableDelegation` of exactly that
 * delegation, signed and paid by its own server wallet after foreground consent. It records nothing in the operation:
 * the chain is the record, and `operation resume` closes the operation only from the manager's disabled flag with the
 * redemption count 0 at one finality block. Repeating it can never move USDC. Each call pins the pending nonce it was
 * priced at, so two calls at one nonce land at most once; a call priced after another landed fails its gas estimate and
 * is not sent. Gas is lost only when a call is priced before another lands and is sent after it (`AlreadyDisabled`).
 * `assertAvailable` refuses while an operation that may use the server wallet's own account is unresolved; it runs under
 * the account's evm-owner lock, before pricing and again with the send.
 */
export async function revokeMetaMaskGasless(state: StateStore, op: MetaMaskGaslessOperationRecord, rpcFor: MetaMaskGaslessRpcFactory,
  dependencies: MetaMaskRevocationDependencies, assertAvailable: () => Promise<void>): Promise<Readonly<Record<string, unknown>>> {
  const id = op.operationId, resume = `apn operation resume --operation ${id}`;
  if (!(REVOCABLE as readonly string[]).includes(op.state) || op.submissionAttempts !== 1) {
    throw new ApnError("APN_OPERATION_BLOCKED", op.state === "dispatch_pending"
      ? "This operation's dispatch is not observed yet; resume it first." : op.submissionAttempts === 1
        ? "This operation's delegation has a proved outcome; there is nothing to disable."
        : "This operation never sent its delegation to MetaMask; there is nothing to disable.",
    { reason: "mm_revoke_not_revocable", operationId: id, state: op.state,
      nextActions: [op.state === "dispatch_pending" ? resume : `apn operation status --operation ${id}`] });
  }
  const { approval, wallet } = dependencies;
  if (approval === undefined || wallet === undefined) {
    throw new ApnError("APN_FOREGROUND_APPROVAL_REQUIRED", "Confirm the delegation disable in a foreground terminal.",
      { reason: "mm_revoke_approval", nextActions: [`apn gasless transfer revoke --operation ${id}`] });
  }
  await metaMaskGaslessOwner(state, op.intent.profile, op.intent.binding);
  const owner = evmAddressLock(op.intent.binding.address);
  await state.withLocks([owner], assertAvailable);
  const dispatched = mmDispatchIntent(op), chainId = dispatched.request.chainId, call = mmDisableCall(dispatched);
  const rpc = rpcFor(chainId), revocationBalance = rpc.revocationBalance;
  if (rpc.chainId !== chainId || rpc.revocation === undefined || revocationBalance === undefined) {
    throw new ApnError("APN_RPC_CONFIG", "The configured RPC cannot price a delegation disable.", { reason: "mm_revoke_rpc" });
  }
  const chain = await rpc.revocation(dispatched, call, id);
  assertNativeGas(chain.nativeBalanceWei, chain.maximumNativeCostWei, chainId, call.from, id);
  const summary = metaMaskRevocationSummary(id, chainId, call, chain);
  if (!await approval.confirm(summary)) {
    throw new ApnError("APN_OPERATION_BLOCKED", "The delegation disable was not confirmed; nothing was sent.", { reason: "mm_revoke_refused" });
  }
  const submitted = await state.withLocks([owner, "provider-session:metamask-agent-wallet"], async () => {
    await assertAvailable();
    // `mm wallet send-transaction` read the wallet's native balance right before its POST; the helper does not. The same
    // refusal as at pricing, with nothing sent, when the balance no longer covers the priced maximum.
    assertNativeGas(await revocationBalance.call(rpc, dispatched, call), chain.maximumNativeCostWei, chainId, call.from, id);
    return await wallet.send({ chainId, from: call.from, payload: mmRevocationPayload(call, chain),
      intent: `APN ${id}: disable delegation ${call.delegationHash}` });
  });
  const unsent = metaMaskRevocationUnsentCause(submitted);
  return { operation_id: id, chain_id: chainId, kind: "metamask_delegation_disable", delegator: call.from, delegation_manager: call.to,
    delegation_hash: call.delegationHash, call_hash: call.callHash, fingerprint: summary.fingerprint,
    nonce_atomic: chain.nonceAtomic, gas_limit_atomic: chain.gasLimitAtomic, max_fee_per_gas_atomic: chain.maxFeePerGasAtomic,
    maximum_native_cost_wei: chain.maximumNativeCostWei, submission: submitted, proof_class: "owner_wallet_handoff_unproven",
    next_actions: [...submitted.disposition === "pending" ? ["Confirm this disable request in MetaMask Mobile or the email registered to your MetaMask dashboard."] : [],
      ...submitted.disposition === "unknown" ? [unsent === undefined
        ? unconfirmedDisable(submitted.providerErrorCode, call.from, chain.nonceAtomic, id)
        : unsentDisable(unsent, submitted.helperFailure, call.from, chain.nonceAtomic, id)] : [],
      resume] };
}

/** The server wallet's native balance must cover the disable's priced maximum cost; otherwise nothing is sent. */
function assertNativeGas(balanceWei: string, maximumWei: string, chainId: number, from: string, id: string): void {
  if (BigInt(balanceWei) >= BigInt(maximumWei)) return;
  throw new ApnError("APN_INSUFFICIENT_GAS", `The server wallet ${from} holds ${balanceWei} wei of native gas on chain ` +
    `${chainId}; this disable can cost up to ${maximumWei} wei. Nothing was sent.`,
  { reason: "mm_revoke_native_gas", chain_id: chainId, address: from, native_balance_wei: balanceWei, maximum_native_cost_wei: maximumWei,
    nextActions: [`Send at least ${(BigInt(maximumWei) - BigInt(balanceWei)).toString()} wei of chain ${chainId}'s native coin (no USDC) to ${from}, then rerun: apn gasless transfer revoke --operation ${id}`] });
}

/** Each closed cause of a stop before the network, as words, and the step that removes it before running `again`. */
const UNSENT: Readonly<Record<MetaMaskRevocationUnsentCause, (from: string, again: string) => readonly [string, string]>> = {
  deadline: (_from, again) => ["its 120-second send bound passed before the request was written", `Run ${again}.`],
  clock: (_from, again) => ["the system clock was invalid or moved backwards", `Correct the system clock, then run ${again}.`],
  launch: (_from, again) => ["the helper process did not start", `Run ${again}.`],
  session_binding: (from, again) => [`the signed-in MetaMask Agent Wallet is in another project or has another wallet than ${from} selected`,
    `Select the server wallet ${from} in the MetaMask Agent Wallet, then run ${again}.`],
  session_signed_out: (_from, again) => ["the MetaMask Agent Wallet is signed out or its session expired",
    `Sign in to the MetaMask Agent Wallet again, then run ${again}.`],
  session_files: (_from, again) => ["the MetaMask Agent Wallet's files on this machine could not be read",
    `Sign in to the MetaMask Agent Wallet again, then run ${again}.`],
  sdk_load: (_from, again) => ["the MetaMask SDK bundled with APN did not load", `Run ${again}; reinstall APN if it stops here again.`],
  hydrate: (_from, again) => ["the MetaMask SDK could not restore the signed-in session",
    `Sign in to the MetaMask Agent Wallet again, then run ${again}.`],
  binding: (from, again) => [`the MetaMask SDK named another server wallet than ${from}`,
    `Select the server wallet ${from} in the MetaMask Agent Wallet, then run ${again}.`],
};
/**
 * After a helper that stopped before any network call (its own closed facts): no disable left this machine and its nonce
 * is untouched, so running revoke again is safe. The step names the cause those facts give. The answer stays unknown.
 */
function unsentDisable(cause: MetaMaskRevocationUnsentCause, reason: string | undefined, from: string, nonce: string, id: string): string {
  const hex = `0x${BigInt(nonce).toString(16)}`, [words, step] = UNSENT[cause](from, `apn gasless transfer revoke --operation ${id} again`);
  return `The MetaMask helper stopped before any network call: ${words}${reason === undefined ? "" : ` (${reason})`}. No disable left this ` +
    `machine and nonce ${hex} (${nonce}) of ${from} is untouched, so running revoke again is safe. ${step}`;
}

/**
 * After an unknown answer: the resume reads the chain, and two public reads tell whether another disable is safe. Each
 * disable is priced at the wallet's pending nonce, and revoke refuses while the pending nonce is past the latest one;
 * with both still at this one's nonce, no transaction of the wallet used it or waits in the RPC's pool, so the next
 * disable takes the same nonce and at most one of the two can land. A request MetaMask still holds for MFA is the only
 * one no RPC shows; it carries the same nonce.
 */
function unconfirmedDisable(code: string | undefined, from: string, nonce: string, id: string): string {
  const hex = `0x${BigInt(nonce).toString(16)}`;
  return `MetaMask did not confirm this disable${code === undefined ? "" : ` (MetaMask error code ${code})`}. Run the resume below: ` +
    `it reads whether the delegation is disabled. If it is not, and eth_getTransactionCount(${from}, "latest") and ` +
    `eth_getTransactionCount(${from}, "pending") on this chain both still answer ${hex} (${nonce}), no transaction used ` +
    `this disable's nonce or waits for it: remove the cause, then run apn gasless transfer revoke --operation ${id} again. ` +
    `It moves no USDC, and with the same nonce only one of the two disables can land.`;
}
