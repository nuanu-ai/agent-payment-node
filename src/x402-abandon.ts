import { ApnError } from "./errors.js";
import { formatAtomic } from "./money.js";
import { canonicalOperationId } from "./transfer-policy.js";
import { X402Lifecycle } from "./x402-lifecycle.js";
import { publicX402Operation, type X402OperationRecord } from "./x402-state-integrity.js";

/**
 * Owner exit for a local x402 purchase whose outcome the chain cannot settle for APN. It is offered
 * only after validBefore, when the signed authorization can no longer execute, and never replaces
 * a proof APN already holds. It signs, sends and pays nothing.
 */
export class X402AbandonService extends X402Lifecycle {
  async abandon(operationIdInput: string): Promise<unknown> {
    const operationId = canonicalOperationId(operationIdInput);
    const found = await this.operations.required(operationId);
    if (found.kind !== "x402_fetch" || found.strategy !== "local") throw new ApnError("APN_OPERATION_BLOCKED", "Operation is not a local x402 fetch.");
    const { profileHash } = found.record;
    return await this.context.state.withLocks([`profile:${profileHash}`, `operation:${operationId}`], async () => {
      const loaded = await this.context.state.loadX402Operation(profileHash, operationId);
      if (loaded === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Operation was not found.");
      const recovered = await this.recoverOrphanReceipt(loaded);
      const current = recovered ?? loaded;
      if (current.state === "abandoned_unknown" || current.terminal) {
        if (current.state === "abandoned_unknown") {
          await this.followUsage(profileHash, operationId);
          return publicX402Operation(current);
        }
        throw new ApnError("APN_OPERATION_BLOCKED", "The x402 operation is already terminal.");
      }
      const nowUnix = BigInt(Math.floor(this.context.clock.now().getTime() / 1000));
      if (nowUnix < BigInt(current.authorization.validBefore)) {
        throw new ApnError("APN_OPERATION_BLOCKED", "The x402 authorization can still settle; abandon is available only after its validity window.", {
          validBefore: current.authorization.validBefore,
        });
      }
      // Nothing was signed before approval, so this outcome is proven rather than acknowledged.
      if (current.state === "awaiting_approval") return publicX402Operation(await this.commitTerminal(current, "failed_before_effect"));
      if (current.unusedExpiryEvidence !== undefined || current.settlementEvidence !== undefined) {
        throw new ApnError("APN_OPERATION_BLOCKED", "The chain already proves this x402 outcome; use operation resume to finish it.");
      }
      await this.context.requireOperationAbandonApproval().approve(abandonIntent(current));
      const settled = current.state === "paid_request_pending" ? await this.markInterruptedPaidAttempt(current, "effect_unknown") : current;
      const abandoned = await this.commitTerminal(settled, "abandoned_unknown");
      await this.followUsage(profileHash, operationId);
      return publicX402Operation(abandoned);
    });
  }
}

function abandonIntent(operation: X402OperationRecord) {
  return {
    operationId: operation.operationId,
    fingerprint: operation.fingerprint,
    profile: operation.profile,
    providerId: operation.providerSigner?.providerId ?? operation.delegatedMaterial?.providerId ?? "local",
    walletAddress: operation.wallet,
    recipient: operation.payee,
    amountAtomic: operation.amountAtomic,
    // Released USDC records are 6-decimal USDC; any other token shows the decimals() it answered at prepare.
    amountDecimal: operation.tokenFacts === undefined ? usdcDecimal(operation.amountAtomic) : formatAtomic(operation.amountAtomic, operation.tokenFacts.decimals),
    chainLabel: `EVM chain ${operation.chainId} (${operation.network})`,
    assetLabel: operation.tokenFacts === undefined ? `USDC (${operation.token})` : `token ${operation.token} (${operation.tokenFacts.decimals} decimals, read on chain at prepare)`,
    unit: operation.tokenFacts === undefined ? "USDC" : "token units",
    outcomeNote: "Financial outcome: UNKNOWN. The x402 authorization can no longer execute, but it may have settled before its validity window closed.",
  };
}

function usdcDecimal(value: string): string {
  const padded = value.padStart(7, "0");
  const fraction = padded.slice(-6).replace(/0+$/u, "");
  return fraction === "" ? padded.slice(0, -6) : `${padded.slice(0, -6)}.${fraction}`;
}
