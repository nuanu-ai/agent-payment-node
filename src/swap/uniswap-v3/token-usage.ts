import { canonicalJson, domainHash } from "../../canonical.js";
import { assertRecipientAdmitted } from "../../allowlist-recipient-pins.js";
import { evaluateAssetPolicy, type AssetPolicyRegistry } from "../../asset-policy-registry.js";
import { loadActiveAssetPolicyRegistry } from "../../allowlist-active-policy.js";
import { AssetUsageLedger, assetUsageReservationId, type AssetUsageIdentity, type AssetUsageState } from "../../asset-usage-ledger.js";
import { ApnError } from "../../errors.js";
import type { ClockPort } from "../../ports.js";
import type { StateStore } from "../../state.js";
import { assetAdmitsSwapMechanism } from "../route-admission.js";
import type { UniswapTokenQuoteRequest } from "./token-builder.js";
import type { UniswapTokenOperation } from "./token-operation.js";
import type { UniswapTokenMaterial } from "./token-material.js";
import { UNISWAP_TOKEN_MECHANISM_PIN, type UniswapTokenRoute } from "./token-route.js";

export interface TokenUsageBinding { readonly reservationId: string; readonly state: AssetUsageState }
type Target = Exclude<AssetUsageState, "reserved">;

export class UniswapTokenUsage {
  constructor(private readonly state: StateStore, private readonly clock: ClockPort, private readonly ledger: AssetUsageLedger) {}

  async admitQuote(request: UniswapTokenQuoteRequest, now: Date): Promise<string> {
    const active = await this.active(request.profile, request.account), identity = usageIdentity(request.account, request.sourceToken);
    const current = await this.ledger.usage(identity, now);
    const source = evaluateAssetPolicy(active.registry, { chain: identity.chain, asset: identity.asset, rail: "swap", amountAtomic: request.amountAtomic,
      dailyUsageAtomic: current.amountAtomic, asOfDate: now.toISOString().slice(0, 10), asOf: now.toISOString() });
    const destination = evaluateAssetPolicy(active.registry, { chain: "eip155:1", asset: { kind: "token", identifier: request.outputToken },
      rail: "swap", amountAtomic: request.minimumOutputAtomic, dailyUsageAtomic: "0",
      asOfDate: now.toISOString().slice(0, 10), asOf: now.toISOString() });
    if (!assetAdmitsSwapMechanism(source.asset, UNISWAP_TOKEN_MECHANISM_PIN) || !assetAdmitsSwapMechanism(destination.asset, UNISWAP_TOKEN_MECHANISM_PIN)) {
      blocked("Token pair lacks the exact Uniswap mechanism admission.", "uniswap_token_policy_mechanism");
    }
    assertRecipientAdmitted({ admission: source, recipient: request.recipient });
    assertRecipientAdmitted({ admission: destination, recipient: request.recipient });
    return active.digest;
  }

  async reserve(op: UniswapTokenOperation): Promise<TokenUsageBinding> {
    const active = await this.active(op.profile, op.account);
    if (active.digest !== op.policyDigest) blocked("The active token swap policy changed.", "uniswap_token_policy_changed");
    pinned(active.registry, op.route, this.clock.now());
    const lease = await this.ledger.reserve({ ...identityOf(op), registry: active.registry, rail: "swap", amountAtomic: op.route.amountIn,
      idempotencyKey: usageKey(op.operationId), now: this.clock.now() });
    this.assert(op, lease.reservationId, lease.policyDigest, lease.amountAtomic, lease.rail);
    return { reservationId: lease.reservationId, state: lease.state };
  }

  async confirmMaterial(material: UniswapTokenMaterial): Promise<void> {
    const active = await this.active(material.profile, material.account), now = this.clock.now(), identity = usageIdentity(material.account, material.route.inputToken);
    if (active.digest !== material.policyDigest) blocked("The active token swap policy changed.", "uniswap_token_policy_changed");
    const current = await this.ledger.usage(identity, now);
    evaluateAssetPolicy(active.registry, { chain: identity.chain, asset: identity.asset, rail: "swap", amountAtomic: material.route.amountIn,
      dailyUsageAtomic: current.amountAtomic, asOfDate: now.toISOString().slice(0, 10), asOf: now.toISOString() });
    pinned(active.registry, material.route, now);
  }

  async confirmReserved(op: UniswapTokenOperation): Promise<void> {
    const active = await this.active(op.profile, op.account), now = this.clock.now(), identity = identityOf(op), current = await this.ledger.usage(identity, now);
    if (active.digest !== op.policyDigest || BigInt(current.amountAtomic) < BigInt(op.route.amountIn)) blocked("Token swap usage or policy changed.", "uniswap_token_policy_changed");
    evaluateAssetPolicy(active.registry, { chain: identity.chain, asset: identity.asset, rail: "swap", amountAtomic: op.route.amountIn,
      dailyUsageAtomic: (BigInt(current.amountAtomic) - BigInt(op.route.amountIn)).toString(), asOfDate: now.toISOString().slice(0, 10), asOf: now.toISOString() });
    // Before each signature (approval, swap), never before the cleanup that only revokes the allowance.
    pinned(active.registry, op.route, now);
  }

  async confirmCleanup(op: UniswapTokenOperation): Promise<void> {
    await this.current(op);
  }

  async current(op: UniswapTokenOperation): Promise<TokenUsageBinding> {
    const expected = assetUsageReservationId(identityOf(op), usageKey(op.operationId)), lease = await this.ledger.load(identityOf(op), expected);
    if (lease === null) corrupt("Uniswap token usage reservation is missing.");
    this.assert(op, lease.reservationId, lease.policyDigest, lease.amountAtomic, lease.rail);
    return { reservationId: lease.reservationId, state: lease.state };
  }

  async follow(op: UniswapTokenOperation, target: Target): Promise<TokenUsageBinding> {
    const identity = identityOf(op), expected = assetUsageReservationId(identity, usageKey(op.operationId));
    let current = await this.ledger.load(identity, expected);
    if (current === null) corrupt("Uniswap token usage reservation is missing.");
    this.assert(op, current.reservationId, current.policyDigest, current.amountAtomic, current.rail);
    if (current.state === target || target === "submitted" && current.state === "unknown_finality") return { reservationId: expected, state: current.state };
    if (["finalized", "failed_before_effect", "failed_confirmed_revert", "released_unsubmitted"].includes(current.state)) corrupt("Uniswap token usage reached a conflicting terminal state.");
    const move = async (state: Target, terminal = false) => {
      current = await this.ledger.transition({ ...identity, reservationId: expected, policyDigest: op.policyDigest, state, now: this.clock.now(),
        ...(terminal ? { outcomeDigest: domainHash("apn.uniswap-token-usage-outcome.v1", canonicalJson({ operationId: op.operationId,
          state, transactionHash: op.swapAttempt?.transactionHash ?? op.approvalAttempt?.transactionHash ?? null })) } : {}) });
    };
    if (target === "unknown_finality") { if (current.state === "reserved") await move("submitted"); if (current.state === "submitted") await move(target); }
    else if (target === "failed_confirmed_revert") { if (current.state === "reserved") await move("submitted"); await move(target, true); }
    // A swap proven never to land (R4): its hold is released as unsubmitted, nothing of it was spent. A hold a crash left
    // reserved after the swap was bound releases directly (the ledger allows both).
    else if (target === "released_unsubmitted") {
      if (op.swapAttempt?.transactionHash == null) corrupt("Uniswap token usage can release as unsubmitted only a bound swap.");
      if (current.state === "submitted") await move("unknown_finality");
      await move(target, true);
    }
    else if (target === "failed_before_effect") {
      // No principal effect: nothing of the swap was signed or bound, or a cleaned or owner-abandoned swap carries the
      // proof that none can land.
      const proven = op.phase === "cleaned" && (op.cleanupEvidence?.kind === "expired_approval_no_swap" || op.principalRelease !== undefined) ||
        op.phase === "abandoned_unknown" && op.principalRelease !== undefined;
      if (current.state !== "reserved" || !proven && (op.swapAttempt !== null || op.approvalAttempt?.transactionHash != null))
        corrupt("Uniswap token usage cannot release after a possible principal effect.");
      await move(target, true);
    }
    else { if (target === "finalized" && current.state === "reserved") await move("submitted"); await move(target, target === "finalized"); }
    return { reservationId: expected, state: current.state };
  }

  private async active(profile: string, account: string) {
    const active = await loadActiveAssetPolicyRegistry({ state: this.state, clock: this.clock }, profile);
    if (active === null || active.accounts.evm !== account) blocked("An active owner token swap policy is required.", "swap_owner_admission_required");
    return active;
  }
  private assert(op: UniswapTokenOperation, id: string, policy: string, amount: string, rail: string) {
    if (id !== assetUsageReservationId(identityOf(op), usageKey(op.operationId)) || policy !== op.policyDigest || amount !== op.route.amountIn || rail !== "swap") {
      corrupt("Uniswap token usage binding changed.");
    }
  }
}
/**
 * The recipient pin (OD-1) of both swap rows, the spent and the received asset's, still lists the route's recipient.
 * Only the pins are the point here (the callers check the spent asset's caps against its usage), so usage is zero.
 */
function pinned(registry: AssetPolicyRegistry, route: UniswapTokenRoute, now: Date): void {
  for (const [token, amountAtomic] of [[route.inputToken, route.amountIn], [route.outputToken, route.amountOutMinimum]] as const) {
    const admission = evaluateAssetPolicy(registry, { chain: "eip155:1", asset: { kind: "token", identifier: token }, rail: "swap",
      amountAtomic, dailyUsageAtomic: "0", asOfDate: now.toISOString().slice(0, 10), asOf: now.toISOString() });
    assertRecipientAdmitted({ admission, recipient: route.recipient });
  }
}
function usageIdentity(account: string, token: string): AssetUsageIdentity { return { account, chain: "eip155:1", asset: { kind: "token", identifier: token } }; }
function identityOf(op: UniswapTokenOperation) { return usageIdentity(op.account, op.route.inputToken); }
function usageKey(operationId: string) { return `apn.uniswap-token-usage:${operationId}`; }
function corrupt(message: string): never { throw new ApnError("APN_STATE_CORRUPT", message); }
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
