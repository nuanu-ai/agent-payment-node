import { canonicalJson, sha256 } from "../canonical.js";
import { ApnError } from "../errors.js";
import { StateStore } from "../state.js";
import { Permit2ProductionRepository } from "./production-repository.js";
import { permit2ProductionOperationDigest } from "./production-signed.js";
import { Permit2ObserverRpc, type Permit2ObservationMetrics } from "./production-observer-rpc.js";
import { assertObserverChain, observerBlock } from "./production-observer-facts.js";
import { signingIdentityCalls, signingTokenCalls, assertSigningIdentity, assertSigningTokens, assertSigningTime } from "./production-signing-facts.js";
import { signingOwnerFence, type Permit2SigningMode } from "./production-signing-owner.js";
import { Permit2MetadataLockOwner, type Permit2MetadataLockScope } from "./production-signing-scope.js";
export type { Permit2MetadataLockScope } from "./production-signing-scope.js";
export type { Permit2SigningMode } from "./production-signing-owner.js";

export interface Permit2SigningFact { readonly kind: "checked-permit2-signing-observation" }
export interface Permit2SigningProjection {
  readonly operationId: string; readonly mode: Permit2SigningMode;
  readonly outcome: "checked" | "hold";
  readonly operationDigest: string | null; readonly recordHash: string | null;
  readonly materialHash: string | null; readonly walletHash: string | null;
  readonly requestHash: string | null; readonly challengeHash: string | null;
  readonly originalLeaseDigest: string | null; readonly currentLeaseDigest: string | null;
  readonly capturedAt: string | null; readonly blockNumber: string | null; readonly blockHash: string | null;
  readonly rpc: Permit2ObservationMetrics;
}
type OwnedSigningContext = Awaited<ReturnType<typeof signingOwnerFence>>;
/** Actual read-only observation only. Never human approval, custody permission, or transport authority. */
export class Permit2ProductionSigningFence {
  readonly #state: StateStore;
  readonly #records: Permit2ProductionRepository;
  readonly #facts = new WeakMap<Permit2SigningFact, { readonly context: OwnedSigningContext; readonly projection: Permit2SigningProjection; readonly scope?: Permit2MetadataLockScope }>();
  readonly #scopes: Permit2MetadataLockOwner;
  readonly #endpoint: string;
  readonly #clock: () => Date;
  constructor(root: string, endpoint: string, clock: () => Date = () => new Date()) {
    if (typeof root !== "string" || typeof endpoint !== "string") invalid();
    this.#endpoint = endpoint; this.#clock = clock;
    this.#state = new StateStore(root); this.#records = new Permit2ProductionRepository(root);
    this.#scopes = new Permit2MetadataLockOwner(this.#state, this.#records);
  }
  #now = (): Date => {
    const now = this.#clock(); if (!(now instanceof Date) || !Number.isSafeInteger(now.getTime()) || now.getTime() < 0) invalid();
    return new Date(now.getTime());
  };
  static assertNativeScope(fence: Permit2ProductionSigningFence, scope: Permit2MetadataLockScope, root: string, id: string): void {
    if (Object.getPrototypeOf(fence) !== Permit2ProductionSigningFence.prototype || fence.#state.root !== root) invalid(); fence.#scopes.assert(scope, id, "exposed");
  }
  static async withNativeScope<T>(fence: Permit2ProductionSigningFence, root: string, id: string,
    action: (scope: Permit2MetadataLockScope) => Promise<T>): Promise<T> {
    identity(id, "exposed"); if (Object.getPrototypeOf(fence) !== Permit2ProductionSigningFence.prototype || fence.#state.root !== root) invalid();
    return fence.#scopes.within(id, "exposed", fence.#now, action);
  }
  static async nativeScopeOwner(fence: Permit2ProductionSigningFence, scope: Permit2MetadataLockScope, root: string, id: string) {
    this.assertNativeScope(fence, scope, root, id);
    const owned = await fence.#scopes.owner(scope, id, "exposed", fence.#now);
    this.assertNativeScope(fence, scope, root, id); freeze(owned); return owned;
  }
  static async checkNativeScoped(fence: Permit2ProductionSigningFence, scope: Permit2MetadataLockScope, root: string, id: string) {
    this.assertNativeScope(fence, scope, root, id); return fence.#runCheck(id, "exposed", scope);
  }
  static async consumeNativeScoped(fence: Permit2ProductionSigningFence, scope: Permit2MetadataLockScope,
    fact: Permit2SigningFact, root: string, id: string) {
    this.assertNativeScope(fence, scope, root, id); return fence.#consumeOwned(fact, id, "exposed", scope);
  }
  static assertNativeDispatchScope(fence: Permit2ProductionSigningFence, scope: Permit2MetadataLockScope, root: string, id: string): void {
    identity(id, "exposed"); if (Object.getPrototypeOf(fence) !== Permit2ProductionSigningFence.prototype || fence.#state.root !== root) invalid();
    fence.#scopes.assert(scope, id, "dispatch");
  }
  static assertNativeDispatchTime(fence: Permit2ProductionSigningFence, scope: Permit2MetadataLockScope, root: string, id: string, at: Date): void {
    this.assertNativeDispatchScope(fence, scope, root, id); fence.#scopes.assertTime(scope, id, "dispatch", at);
  }
  static async withNativeDispatchScope<T>(fence: Permit2ProductionSigningFence, root: string, id: string,
    action: (scope: Permit2MetadataLockScope) => Promise<T>): Promise<T> {
    identity(id, "exposed"); if (Object.getPrototypeOf(fence) !== Permit2ProductionSigningFence.prototype || fence.#state.root !== root) invalid();
    return fence.#scopes.within(id, "dispatch", fence.#now, action);
  }
  static async nativeDispatchScopeOwner(fence: Permit2ProductionSigningFence, scope: Permit2MetadataLockScope, root: string, id: string) {
    this.assertNativeDispatchScope(fence, scope, root, id);
    const owned = await fence.#scopes.owner(scope, id, "dispatch", fence.#now);
    this.assertNativeDispatchScope(fence, scope, root, id); freeze(owned); return owned;
  }
  async check(operationId: string, mode: Permit2SigningMode): Promise<{ readonly projection: Permit2SigningProjection; readonly fact: Permit2SigningFact | null }> {
    return this.#runCheck(operationId, mode);
  }
  /** Scope owns actual metadata locks only; the callback receives no key/signing grant. */
  async withScope<T>(operationId: string, mode: Permit2SigningMode, action: (scope: Permit2MetadataLockScope) => Promise<T>): Promise<T> {
    const id = operationId, selected = mode; identity(id, selected);
    return this.#scopes.within(id, selected, this.#now, action);
  }
  async checkScoped(scope: Permit2MetadataLockScope, operationId: string, mode: Permit2SigningMode) {
    const id = operationId, selected = mode; identity(id, selected); this.#scopes.assert(scope, id, selected);
    return this.#runCheck(id, selected, scope);
  }
  async #runCheck(operationId: string, mode: Permit2SigningMode, scope?: Permit2MetadataLockScope): Promise<{ readonly projection: Permit2SigningProjection; readonly fact: Permit2SigningFact | null }> {
    const id = operationId, selected = mode; identity(id, selected);
    const rpc = new Permit2ObserverRpc(this.#endpoint, this.#state);
    const unbind = scope === undefined ? () => {} : this.#scopes.onExit(scope, id, selected, () => rpc.close());
    let onAbort: (() => void) | undefined;
    try {
      const pipeline = (async () => {
        const context = await this.#owner(id, selected, scope);
        open(rpc.signal); freeze(context);
        const first = await rpc.batch([{ method: "eth_chainId", params: [] }, { method: "eth_getBlockByNumber", params: ["finalized", false] }]);
        assertObserverChain(first[0]); const block = observerBlock(first[1], "finalized");
        assertSigningTime(context.record, this.#now(), block);
        assertSigningIdentity(context.record, await rpc.batch(signingIdentityCalls(context.record, block)));
        assertSigningTokens(context.record, await rpc.batch(signingTokenCalls(context.record, block)));
        const again = await rpc.batch([{ method: "eth_chainId", params: [] }, { method: "eth_getBlockByNumber", params: [block.tag, false] }]);
        assertObserverChain(again[0]); const rechecked = observerBlock(again[1], block.tag);
        if (rechecked.hash !== block.hash || rechecked.number !== block.number || rechecked.timestamp !== block.timestamp) invalid();
        await this.#owner(id, selected, scope, context);
        open(rpc.signal); const captured = this.#now(); assertSigningTime(context.record, captured, block);
        return { context, block, captured };
      })();
      const checked = await Promise.race([pipeline, new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new ApnError("APN_RPC_AMBIGUOUS", "Permit2 signing fence reached its shared deadline."));
        rpc.signal.addEventListener("abort", onAbort, { once: true }); if (rpc.signal.aborted) onAbort();
      })]);
      open(rpc.signal); if (scope !== undefined) this.#scopes.assert(scope, id, selected);
      const { record, lease } = checked.context;
      const projection: Permit2SigningProjection = Object.freeze({ operationId: id, mode: selected, outcome: "checked",
        operationDigest: permit2ProductionOperationDigest(record), recordHash: record.integrityHash, materialHash: record.material.materialHash,
        walletHash: sha256(canonicalJson(record.material.wallet)), requestHash: record.material.checked.requestHash,
        challengeHash: record.material.checked.challengeHash, originalLeaseDigest: record.usageReservationDigest,
        currentLeaseDigest: lease.reservationDigest, capturedAt: checked.captured.toISOString(), blockNumber: checked.block.number,
        blockHash: checked.block.hash, rpc: rpc.metrics() });
      const fact = Object.freeze({ kind: "checked-permit2-signing-observation" as const });
      this.#facts.set(fact, { context: checked.context, projection, ...(scope === undefined ? {} : { scope }) });
      return Object.freeze({ projection, fact });
    } catch {
      return Object.freeze({ projection: Object.freeze({ operationId: id, mode: selected, outcome: "hold", operationDigest: null,
        recordHash: null, materialHash: null, walletHash: null, requestHash: null, challengeHash: null, originalLeaseDigest: null,
        currentLeaseDigest: null, capturedAt: null, blockNumber: null, blockHash: null, rpc: rpc.metrics() }), fact: null });
    } finally { if (onAbort !== undefined) rpc.signal.removeEventListener("abort", onAbort); unbind(); rpc.close(); }
  }
  /** Single-use private provenance; owned lifecycle/lease/owner and trusted age are rechecked, never caller facts. */
  async consume(fact: Permit2SigningFact, operationId: string, mode: Permit2SigningMode): Promise<Permit2SigningProjection> {
    return this.#consumeOwned(fact, operationId, mode);
  }
  async consumeScoped(scope: Permit2MetadataLockScope, fact: Permit2SigningFact, operationId: string, mode: Permit2SigningMode): Promise<Permit2SigningProjection> {
    const id = operationId, selected = mode; identity(id, selected); this.#scopes.assert(scope, id, selected);
    return this.#consumeOwned(fact, id, selected, scope);
  }
  async #consumeOwned(fact: Permit2SigningFact, operationId: string, mode: Permit2SigningMode, scope?: Permit2MetadataLockScope): Promise<Permit2SigningProjection> {
    const id = operationId, selected = mode; identity(id, selected);
    const saved = this.#facts.get(fact);
    if (saved === undefined || saved.scope !== scope || saved.projection.operationId !== id || saved.projection.mode !== selected) invalid();
    const assertAge = () => {
      const now = this.#now(), at = Date.parse(saved.projection.capturedAt!);
      if (now.getTime() < at || now.getTime() - at > 5_000) invalid();
      assertSigningTime(saved.context.record, now);
    };
    assertAge(); await this.#owner(id, selected, scope, saved.context);
    if (scope !== undefined) this.#scopes.assert(scope, id, selected); assertAge();
    if (this.#facts.get(fact) !== saved) invalid(); this.#facts.delete(fact); return saved.projection;
  }
  async #owner(id: string, mode: Permit2SigningMode, scope?: Permit2MetadataLockScope, expected?: OwnedSigningContext): Promise<OwnedSigningContext> {
    return scope === undefined ? signingOwnerFence(this.#state, this.#records, id, mode, this.#now, expected) :
      this.#scopes.owner(scope, id, mode, this.#now, expected);
  }
}
function identity(id: string, mode: Permit2SigningMode): void { if (typeof id !== "string" || !/^[a-f0-9]{64}$/u.test(id) || !["reserved", "exposed"].includes(mode)) invalid(); }
function open(signal: AbortSignal): void { if (signal.aborted) invalid(); }
function freeze(value: unknown): void { if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } }
function invalid(): never { throw new ApnError("APN_OPERATION_BLOCKED", "Permit2 signing fact is not current or bound to the owned operation."); }
