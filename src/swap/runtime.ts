import { canonicalJson, domainHash, exactKeys, isPlainRecord } from "../canonical.js";
import type { AssetPolicyRegistry } from "../asset-policy-registry.js";
import { ApnError } from "../errors.js";
import type { AssetUsageLedger } from "../asset-usage-ledger.js";
import type { ClockPort } from "../ports.js";
import { SecureStateStore, stateIdentifier } from "../secure-state-store.js";
import { validateSwapOperation, type SwapOperationRecord } from "./model.js";
import type { SwapProtocolRegistry } from "./protocol-registry.js";
import { validateSwapQuote, type SwapQuoteInput, type SwapQuoteSnapshot } from "./quote.js";
import { SwapOperationRepository } from "./repository.js";
import { GuardedSwapService } from "./service.js";

export const GUARDED_SWAP_APPROVAL_SCHEMA = "apn.guarded-swap-approval.v1" as const;

export interface GuardedSwapPreparedMaterial {
  readonly quote: SwapQuoteInput | SwapQuoteSnapshot;
  readonly approvalCapAtomic: string;
  /** Exact gas or energy fields displayed to the owner. Values must be canonical unsigned integers. */
  readonly gasOrEnergy: Readonly<Record<string, string>>;
  /** Chain-specific unsigned material. The execution driver must bind it to quote.unsignedTransactionPayloadHash. */
  readonly execution: unknown;
}

export interface GuardedSwapReadOnlyBuilder<Request> {
  quote(input: Request & { readonly now: Date }): Promise<unknown>;
  load(quoteHash: string): Promise<GuardedSwapPreparedMaterial | null>;
}

/**
 * Resolves the owner's active sealed asset policy for one profile. Null means no owner admission is installed and
 * every preparation or approval refuses with swap_owner_admission_required. The allowlist activation supplies it.
 */
export type GuardedSwapPolicyResolver = (profile: string) => Promise<AssetPolicyRegistry | null>;

export interface GuardedSwapOwnerAdmissionPort {
  /** Fails closed when the owner, wallet, or active policy no longer matches. Any returned value is ignored. */
  assert(operation: SwapOperationRecord, material: GuardedSwapPreparedMaterial): Promise<unknown>;
}

export interface GuardedSwapApprovalIntent {
  readonly operationId: string;
  readonly profile: string;
  readonly account: string;
  readonly recipient: string;
  readonly inputAmountAtomic: string;
  readonly expectedOutputAtomic: string;
  readonly minimumOutputAtomic: string;
  readonly slippageBps: number;
  readonly gasOrEnergy: Readonly<Record<string, string>>;
  readonly deadline: string;
  readonly quoteHash: string;
  readonly policyDigest: string;
  readonly mechanismDigest: string;
  readonly protocolRegistryDigest: string;
}

export interface GuardedSwapApprovalArtifact extends GuardedSwapApprovalIntent {
  readonly schemaVersion: typeof GUARDED_SWAP_APPROVAL_SCHEMA;
  readonly approvedAt: string;
  readonly expiresAt: string;
  readonly verifierProofHash: string;
  readonly artifactHash: string;
}

export interface GuardedSwapForegroundApprovalPort {
  /** MCP implementations must refuse or hand off. Only a foreground verifier may return an artifact. */
  approve(intent: GuardedSwapApprovalIntent): Promise<unknown>;
}

export interface GuardedSwapExecutionDriver {
  /** Must persist the submission marker before signing and attempt the sender at most once. */
  execute(input: GuardedSwapExecutionInput): Promise<SwapOperationRecord>;
  /** Must only observe. It may never sign or send. */
  observe(input: GuardedSwapObservationInput): Promise<SwapOperationRecord>;
}

export interface GuardedSwapExecutionInput {
  readonly operation: SwapOperationRecord;
  readonly material: GuardedSwapPreparedMaterial;
  readonly approval: GuardedSwapApprovalArtifact;
  readonly dependencies: GuardedSwapExecutionDependencies;
  readonly now: Date;
}
export interface GuardedSwapObservationInput extends Omit<GuardedSwapExecutionInput, "approval"> {}

/** Every effectful dependency is mandatory on an installed runtime. No environment fallback is consulted. */
export interface GuardedSwapExecutionDependencies {
  readonly rpc: object;
  readonly effectStore: object;
  readonly signer: object;
  readonly sender: object;
  readonly observer: object;
  readonly caps: Readonly<Record<string, string>>;
}

export interface GuardedSwapRuntimeDependencies<Request> extends GuardedSwapExecutionDependencies {
  readonly chain: string;
  readonly builder: GuardedSwapReadOnlyBuilder<Request>;
  readonly policy: GuardedSwapPolicyResolver;
  /** Read again after every human prompt: consent time is never the command start time. */
  readonly clock: ClockPort;
  readonly protocolRegistry: SwapProtocolRegistry;
  readonly usage: AssetUsageLedger;
  readonly operations: SwapOperationRepository;
  readonly ownerAdmission: GuardedSwapOwnerAdmissionPort;
  readonly foregroundApproval: GuardedSwapForegroundApprovalPort;
  readonly execution: GuardedSwapExecutionDriver;
  readonly approvals: GuardedSwapApprovalRepository;
}

export class GuardedSwapApprovalRepository extends SecureStateStore {
  private initialized: Promise<void> | undefined;
  async store(operationValue: SwapOperationRecord, artifactValue: unknown): Promise<GuardedSwapApprovalArtifact> {
    const operation = validateSwapOperation(operationValue), artifact = validateGuardedSwapApprovalArtifact(artifactValue, operation);
    await this.ready();
    return await this.withLocks([`swap-approval:${operation.operationId}`], async () => {
      const existing = await this.readJson(this.path(operation));
      if (existing !== null) {
        const prior = validateGuardedSwapApprovalArtifact(existing, operation);
        if (prior.artifactHash !== artifact.artifactHash) blocked("A different guarded swap approval already exists.", "swap_approval_replay");
        return prior;
      }
      await this.ensureDirectory(`swap-approvals/${operation.ownerProfileHash}`);
      await this.writeJson(this.path(operation), artifact, true);
      return artifact;
    });
  }
  async load(operationValue: SwapOperationRecord): Promise<GuardedSwapApprovalArtifact | null> {
    const operation = validateSwapOperation(operationValue); await this.ready();
    const value = await this.readJson(this.path(operation));
    return value === null ? null : validateGuardedSwapApprovalArtifact(value, operation);
  }
  private path(operation: SwapOperationRecord): string {
    stateIdentifier(operation.ownerProfileHash, "swap approval profile"); stateIdentifier(operation.operationId, "swap approval operation");
    return `swap-approvals/${operation.ownerProfileHash}/${operation.operationId}.json`;
  }
  private async ready(): Promise<void> {
    this.initialized ??= (async () => { await super.initialize(); await this.ensureDirectory("swap-approvals"); })();
    await this.initialized;
  }
}

/** Explicitly injected command runtime. Installed builds do not construct this class by default. */
export class GuardedSwapRuntime<Request> {
  readonly service: GuardedSwapService;
  constructor(readonly dependencies: GuardedSwapRuntimeDependencies<Request>) {
    assertDependencyObject(dependencies);
    this.service = new GuardedSwapService(dependencies.operations, dependencies.usage);
  }

  async quote(request: Request, now: Date): Promise<unknown> { instant(now); return await this.dependencies.builder.quote({ ...request, now }); }

  async prepare(request: { readonly profile: string; readonly quoteHash: string; readonly idempotencyKey: string }, now: Date): Promise<SwapOperationRecord> {
    const material = await this.material(request.quoteHash);
    const quote = validateSwapQuote(material.quote, "input");
    if (quote.profile !== request.profile || quote.quoteHash !== request.quoteHash || quote.sourceAsset.chain !== this.dependencies.chain ||
        quote.destinationAsset.chain !== this.dependencies.chain) blocked("Prepared quote does not match the exact profile, hash, or chain.", "swap_quote_binding");
    const assetPolicy = await this.activePolicy(request.profile);
    // The core re-derives the identical quote hash from the unsealed input; bindMaterial later proves equality.
    const { schemaVersion: _schema, profileHash: _profile, quoteHash: _hash, ...input } = quote;
    return await this.service.prepare({ quote: input, assetPolicy,
      protocolRegistry: this.dependencies.protocolRegistry, idempotencyKey: request.idempotencyKey,
      approvalCapAtomic: material.approvalCapAtomic, now });
  }

  async approve(operationId: string, now: Date): Promise<SwapOperationRecord> {
    const operation = await this.required(operationId);
    if (operation.state !== "awaiting_approval") blocked("Guarded swap is not awaiting foreground approval.", "swap_approval_state");
    instant(now);
    const material = await this.material(operation.quote.quoteHash); bindMaterial(operation, material);
    const policy = await this.activePolicy(operation.quote.profile);
    await this.dependencies.ownerAdmission.assert(operation, material);
    const intent = approvalIntent(operation, material), answer = await this.dependencies.foregroundApproval.approve(intent);
    // The human may type for a while: validate against a fresh clock, and reserve at the sealed consent instant.
    const artifact = validateGuardedSwapApprovalArtifact(answer, operation, intent, this.now());
    const reserved = await this.service.reserve(operation, policy, new Date(artifact.approvedAt));
    await this.dependencies.approvals.store(reserved, artifact);
    return reserved;
  }

  /** The foreground CLI folds consent and the single send into one command. MCP never reaches this method. */
  async approveAndExecute(operationId: string, now: Date): Promise<SwapOperationRecord> {
    const reserved = await this.approve(operationId, now);
    return await this.execute(reserved.operationId, this.now());
  }

  async execute(operationId: string, now: Date): Promise<SwapOperationRecord> {
    const operation = await this.required(operationId);
    instant(now);
    if (operation.submissionMarker !== null) return await this.observe(operation);
    if (operation.state !== "reserved" || operation.usageLease?.state !== "reserved") {
      blocked("Guarded swap execution requires the exact approved reservation.", "swap_execution_lease");
    }
    const artifact = await this.dependencies.approvals.load(operation);
    if (artifact === null) blocked("Guarded swap approval artifact is missing.", "swap_approval_missing");
    validateGuardedSwapApprovalArtifact(artifact, operation, undefined, this.now());
    const material = await this.material(operation.quote.quoteHash); bindMaterial(operation, material);
    await this.dependencies.ownerAdmission.assert(operation, material);
    const result = validateSwapOperation(await this.dependencies.execution.execute({ operation, material, approval: artifact,
      dependencies: effectDependencies(this.dependencies), now: this.now() }));
    if (result.operationId !== operation.operationId || result.submissionMarker === null) {
      throw new ApnError("APN_STATE_CORRUPT", "Guarded swap execution returned without its durable submission marker.");
    }
    return result;
  }

  async status(operationId: string, now: Date): Promise<SwapOperationRecord> {
    const operation = await this.required(operationId);
    instant(now);
    return operation.submissionMarker === null ? operation : await this.observe(operation);
  }

  private async observe(operation: SwapOperationRecord): Promise<SwapOperationRecord> {
    const material = await this.material(operation.quote.quoteHash); bindMaterial(operation, material);
    const result = validateSwapOperation(await this.dependencies.execution.observe({ operation, material,
      dependencies: effectDependencies(this.dependencies), now: this.now() }));
    if (result.operationId !== operation.operationId || result.submissionMarker === null) {
      throw new ApnError("APN_STATE_CORRUPT", "Guarded swap observation lost its durable submission marker.");
    }
    return result;
  }
  private now(): Date { const value = this.dependencies.clock.now(); instant(value); return value; }
  private async activePolicy(profile: string): Promise<AssetPolicyRegistry> {
    const policy = await this.dependencies.policy(profile);
    if (policy === null) blocked("No active owner swap admission is installed for this profile.", "swap_owner_admission_required");
    return policy;
  }
  private async required(operationId: string): Promise<SwapOperationRecord> {
    const operation = await this.dependencies.operations.loadAny(operationId);
    if (operation === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Swap operation was not found.");
    if (operation.quote.sourceAsset.chain !== this.dependencies.chain) blocked("Swap operation belongs to another runtime.", "swap_runtime_chain");
    return operation;
  }
  private async material(hash: string): Promise<GuardedSwapPreparedMaterial> {
    const material = await this.dependencies.builder.load(hash);
    if (material === null) throw new ApnError("APN_OPERATION_NOT_FOUND", "Prepared swap quote was not found.");
    validateGasOrEnergy(material.gasOrEnergy); return material;
  }
}

export function sealGuardedSwapApproval(intent: GuardedSwapApprovalIntent, approvedAt: Date,
  verifierProofHash: string): GuardedSwapApprovalArtifact {
  const at = instant(approvedAt); hash(verifierProofHash); const body = { schemaVersion: GUARDED_SWAP_APPROVAL_SCHEMA, ...intent,
    approvedAt: at, expiresAt: intent.deadline, verifierProofHash } as const;
  return { ...body, artifactHash: domainHash(GUARDED_SWAP_APPROVAL_SCHEMA, canonicalJson(body)) };
}

export function validateGuardedSwapApprovalArtifact(value: unknown, operation: SwapOperationRecord,
  expected?: GuardedSwapApprovalIntent, now?: Date): GuardedSwapApprovalArtifact {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "operationId", "profile", "account", "recipient",
    "inputAmountAtomic", "expectedOutputAtomic", "minimumOutputAtomic", "slippageBps", "gasOrEnergy", "deadline", "quoteHash",
    "policyDigest", "mechanismDigest", "protocolRegistryDigest", "approvedAt", "expiresAt", "verifierProofHash", "artifactHash"]) ||
      value.schemaVersion !== GUARDED_SWAP_APPROVAL_SCHEMA) blocked("Guarded swap approval artifact is invalid.", "swap_approval_tamper");
  const artifact = value as unknown as GuardedSwapApprovalArtifact, { artifactHash, ...body } = artifact;
  hash(artifact.verifierProofHash); hash(artifact.artifactHash); validateGasOrEnergy(artifact.gasOrEnergy);
  if (artifactHash !== domainHash(GUARDED_SWAP_APPROVAL_SCHEMA, canonicalJson(body)) ||
      canonicalJson(approvalIntent(operation, { gasOrEnergy: artifact.gasOrEnergy })) !== canonicalJson(stripArtifact(artifact)) ||
      (expected !== undefined && canonicalJson(expected) !== canonicalJson(stripArtifact(artifact))) ||
      artifact.expiresAt !== artifact.deadline || artifact.approvedAt < operation.updatedAt || artifact.approvedAt >= artifact.expiresAt ||
      (now !== undefined && (artifact.approvedAt > instant(now) || instant(now) >= artifact.expiresAt))) {
    blocked("Guarded swap approval artifact was changed, replayed, or expired.", "swap_approval_tamper");
  }
  return artifact;
}

function approvalIntent(operation: SwapOperationRecord, material: Pick<GuardedSwapPreparedMaterial, "gasOrEnergy">): GuardedSwapApprovalIntent {
  return { operationId: operation.operationId, profile: operation.quote.profile, account: operation.quote.account,
    recipient: operation.quote.recipient, inputAmountAtomic: operation.quote.inputAmountAtomic,
    expectedOutputAtomic: operation.quote.expectedOutputAtomic, minimumOutputAtomic: operation.quote.minimumOutputAtomic,
    slippageBps: operation.quote.slippageBps, gasOrEnergy: material.gasOrEnergy, deadline: operation.quote.expiresAt,
    quoteHash: operation.quote.quoteHash, policyDigest: operation.policyDigest, mechanismDigest: operation.mechanismDigest,
    protocolRegistryDigest: operation.protocolRegistryDigest };
}
function stripArtifact(value: GuardedSwapApprovalArtifact): GuardedSwapApprovalIntent {
  const { schemaVersion: _schema, approvedAt: _approved, expiresAt: _expires, verifierProofHash: _proof, artifactHash: _hash, ...intent } = value;
  return intent;
}
function bindMaterial(operation: SwapOperationRecord, material: GuardedSwapPreparedMaterial): void {
  const quote = validateSwapQuote(material.quote, "input");
  if (quote.quoteHash !== operation.quote.quoteHash || canonicalJson(quote) !== canonicalJson(operation.quote) ||
      material.approvalCapAtomic !== operation.approvalCapAtomic) blocked("Prepared swap material changed after preparation.", "swap_material_drift");
}
function validateGasOrEnergy(value: unknown): asserts value is Readonly<Record<string, string>> {
  if (!isPlainRecord(value) || Object.keys(value).length === 0 || Object.keys(value).length > 16 ||
      Object.entries(value).some(([key, entry]) => !/^[a-z][a-zA-Z0-9]{0,63}$/u.test(key) || typeof entry !== "string" || !/^(?:0|[1-9][0-9]{0,77})$/u.test(entry))) {
    throw new ApnError("APN_INVALID_INPUT", "Guarded swap gas or energy display is invalid.");
  }
}
function effectDependencies(value: GuardedSwapRuntimeDependencies<unknown>): GuardedSwapExecutionDependencies {
  return { rpc: value.rpc, effectStore: value.effectStore, signer: value.signer, sender: value.sender,
    observer: value.observer, caps: value.caps };
}
function assertDependencyObject(value: GuardedSwapRuntimeDependencies<unknown>): void {
  for (const [name, dependency] of Object.entries({ builder: value.builder, policy: value.policy, clock: value.clock,
    protocolRegistry: value.protocolRegistry, usage: value.usage, operations: value.operations, ownerAdmission: value.ownerAdmission,
    foregroundApproval: value.foregroundApproval, execution: value.execution, approvals: value.approvals, rpc: value.rpc,
    effectStore: value.effectStore, signer: value.signer, sender: value.sender, observer: value.observer, caps: value.caps })) {
    if (dependency === null || dependency === undefined || (typeof dependency !== "object" && typeof dependency !== "function")) {
      throw new ApnError("APN_INVALID_INPUT", `Guarded swap runtime dependency ${name} is required.`);
    }
  }
  if (typeof value.chain !== "string" || value.chain.length < 3) throw new ApnError("APN_INVALID_INPUT", "Guarded swap runtime chain is required.");
}
function hash(value: unknown): string { if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) blocked("Guarded swap approval hash is invalid.", "swap_approval_tamper"); return value; }
function instant(value: Date): string { if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new ApnError("APN_INVALID_INPUT", "Guarded swap time is invalid."); return value.toISOString(); }
function blocked(message: string, reason: string): never { throw new ApnError("APN_OPERATION_BLOCKED", message, { reason }); }
