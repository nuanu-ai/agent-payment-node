import { canonicalJson, hashObject } from "../canonical.js";
import { ApnError } from "../errors.js";
import type { BridgeBlock, BridgeDeploymentIdentity, BridgeProtocolReceipt, BridgeTransactionProof } from "./model.js";
import { bridgeIntentBinding, bridgeSnapshot, sealBridgeOperation, type BridgeOperationRecord, type BridgeTransition,
  type BridgeVerifiedDestinationProof } from "./operation-model.js";
import { validateBridgeOperation, validateLegacyBridgeOperation } from "./operation-validation.js";
import { bridgeDestinationProof, bridgeSourceProof } from "./protocol-evidence.js";

export const BASE_DEPLOYMENT_MIGRATION_SCHEMA = "apn.bridge-base-usdc-deployment-migration.v1" as const;
const operationId = "0e3491acbe5a0b9687d0d18e7e4bc605199a9d8b9cb7ab5c8c9217e303eba189";
const sourceTransactionHash = "0xb7156c7626ce87f2250adcda6ef8e6383308a8c6baa0d8a8c1bbd2bf536e03ea";
const destinationTransactionHash = "0x66d8b4cfd8d676778ed1445a388a7a2bc2e487bf342c13102128461a8b0910e6";
const sourceBlock = { numberAtomic: "25991578", hash: "0xa5d09b09f95cb83bd60cac35e4da453286c69a3123e1ea80ce23f8d75c3ff770", timestampAtomic: "1789580279" } as const;
const destinationBlock = { numberAtomic: "51395469", hash: "0x74f557f8da50f60b81ab32f4871dc619ddf92b08f505edd8c9a56ef8169f2222", timestampAtomic: "1789580285" } as const;
const oldSourceDeployment = {
  chainId: 1, peerChainId: 8453, tool: "across", rpcOrigin: "https://ethereum-rpc.publicnode.com",
  block: { numberAtomic: "25991490", hash: "0x1c59ca0c82c4c5c4367de512bd2e2f34327c164d8a6f0c3f628cf11d5ad57f2e", timestampAtomic: "1789579223" },
  contractHash: "b5a4ad94f455725ae857b2d61cfe52f6886aecddfdf13296ee3244170bd72b0a",
  codeHash: "050dd58c1d09b8c0cf10a62344ba33dec13e11c98cc15d35881ac7162201381b",
  configurationHash: "ca0e2e4c2c76ff3d1a896431f9f595a1e254d93001fe390f8a543fe2341822d1",
} as const;
const oldDestinationDeployment = {
  chainId: 8453, peerChainId: 1, tool: "across", rpcOrigin: "https://base-rpc.publicnode.com",
  block: { numberAtomic: "51395108", hash: "0x43f43936f6e6045c52fcbbe97367cac24d843f99a4e38a2723c0d203417d4a33", timestampAtomic: "1789579563" },
  contractHash: "bf61900beb9f9bba54cce385ce88b3297bdaf6d8f311ccbc451cbf812bf9d997",
  codeHash: "2a422dd13d2b6b06b12aa01892018c18d6ca04660b24f180e585a953045b5f09",
  configurationHash: "45b25bcdabef208739a45af8ffd0e7e3c2445a4e40ca55fbafd8d6627d3788be",
} as const;
const verifiedSourceDeployment = { ...oldSourceDeployment, rpcOrigin: "https://eth.drpc.org", block: sourceBlock } as const;
const newDestinationDeployment = { ...oldDestinationDeployment, rpcOrigin: "https://base.drpc.org", block: destinationBlock } as const;

export const BASE_DEPLOYMENT_MIGRATION_CANDIDATE = Object.freeze({ schemaVersion: BASE_DEPLOYMENT_MIGRATION_SCHEMA,
  operationId, profileHash: "8692e4b95d088a0e95bcab3edf8a641f8d04f54ed4b1d26af61f7a9e344f58bd",
  oldFingerprint: "cee3ce81b8f9d1411ae18775917277298c964195d702204b7432e0ea222ee218",
  oldIntegrityHash: "b22b0a40cf7d29d0ca67be2aeb65072151f9639dc1d8baee246e7d28d52e759a",
  oldTransitionRoot: "51362ebdd03691b307408a62fdc752d69fbd3f71354d5adca95d73a79658ca40",
  newFingerprint: "44ee8db54293fc52a90d54f9167f299504cf0f6924e79206c4909b4318fa67a6",
  newIntegrityHash: "a9301e10cb4bf0b7e63d97e585996be3e4be1ee4c5995b5d647638f6aec6ee69",
  newTransitionRoot: "7b3d6eb3ea075d29788c8c194feff9ecb825b5877cae551173a1b6807767abf9",
  route: { fromChainId: 1, toChainId: 8453, tool: "across", amountAtomic: "2776698", bridgeAmountAtomic: "2769757",
    outputAmountAtomic: "2766208", recipient: "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7",
    fromToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", toToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  approvalTransactionHash: "0xe6d3017ad15f50ac5e784654231440293a8a7e30fce65af732eb7ed26b80a916",
  sourceTransactionHash, destinationTransactionHash, sourceBlock, destinationBlock,
  sourceSafeBlock: { numberAtomic: "26024956", hash: "0x5e404085d24ddc013b6312c58725ced1473ce5a984b3fe3dce46f3ecab91ac88", timestampAtomic: "1789982423" } as const,
  destinationSafeBlock: { numberAtomic: "51596747", hash: "0x5a7faf1f747fdf165ed9267831df50e8e69782d601db422d87a6bef92b5bb937", timestampAtomic: "1789982841" } as const,
  destinationTransactionProofHash: "c0f88fe5350b05930d3ae5b42f8534c345dce4817318cf826c16dc618f3b5ce9",
  oldSourceDeployment, oldDestinationDeployment, verifiedSourceDeployment, newDestinationDeployment,
});

export interface BaseDeploymentMigrationAudit {
  readonly schemaVersion: typeof BASE_DEPLOYMENT_MIGRATION_SCHEMA;
  readonly operationId: string;
  readonly candidateHash: string;
  readonly sourceTransactionHash: string;
  readonly destinationTransactionHash: string;
  readonly oldFingerprint: string;
  readonly newFingerprint: string;
  readonly oldIntegrityHash: string;
  readonly newIntegrityHash: string;
  readonly oldTransitionRoot: string;
  readonly newTransitionRoot: string;
  readonly touchedFields: readonly string[];
  readonly auditDigest: string;
}

export interface BaseMigrationObservation {
  readonly transaction: BridgeTransactionProof;
  readonly receipt: BridgeProtocolReceipt;
}

function same(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }
function blocked(reason: string): never {
  throw new ApnError("APN_OPERATION_BLOCKED", "The saved operation is not eligible for the recognized historical Base USDC deployment migration.", { reason });
}

export function assertBaseDeploymentMigrationProof(operation: BridgeOperationRecord, source: BaseMigrationObservation,
  sourceDeployment: BridgeDeploymentIdentity, destination: BaseMigrationObservation,
  destinationDeployment: BridgeDeploymentIdentity, sourceFinalityBlock: BridgeBlock,
  destinationFinalityBlock: BridgeBlock): BridgeVerifiedDestinationProof {
  const c = BASE_DEPLOYMENT_MIGRATION_CANDIDATE;
  if (!same(sourceFinalityBlock, c.sourceSafeBlock) || !same(destinationFinalityBlock, c.destinationSafeBlock)) blocked("finality_block_mismatch");
  const finalized = (proof: BridgeTransactionProof, minimum: BridgeBlock) => proof.status === "success" && proof.safeBlock !== null &&
    BigInt(proof.safeBlock.numberAtomic) >= BigInt(minimum.numberAtomic) &&
    (proof.safeBlock.numberAtomic !== minimum.numberAtomic || same(proof.safeBlock, minimum));
  if (source.transaction.chainId !== 1 || source.transaction.transactionHash !== c.sourceTransactionHash ||
    source.transaction.rpcOrigin !== c.verifiedSourceDeployment.rpcOrigin || !same(source.transaction.block, c.sourceBlock) ||
    !finalized(source.transaction, c.sourceSafeBlock)) blocked("source_transaction_mismatch");
  const savedSource = operation.effects.find((effect) => effect.role === "bridge")?.safeProof;
  if (savedSource === null || savedSource === undefined || !same({ ...source.transaction, safeBlock: null, rpcOrigin: null },
    { ...savedSource, safeBlock: null, rpcOrigin: null })) blocked("source_transaction_identity_mismatch");
  if (!same(sourceDeployment, c.verifiedSourceDeployment) || !same(sourceDeployment.block, source.transaction.block)) blocked("source_deployment_mismatch");
  let parsedSource;
  try { parsedSource = bridgeSourceProof(operation.intent.materialization, operation.intent.decoded, source.receipt); }
  catch { return blocked("source_correlation_mismatch"); }
  if (!same(parsedSource, operation.sourceProof) || parsedSource.sourceAmountAtomic !== c.route.amountAtomic ||
    parsedSource.bridgeAmountAtomic !== c.route.bridgeAmountAtomic || parsedSource.correlation.kind !== "across" ||
    parsedSource.correlation.outputAmountAtomic !== c.route.outputAmountAtomic || parsedSource.correlation.recipient !== word(c.route.recipient)) blocked("source_correlation_mismatch");
  if (destination.transaction.chainId !== 8453 || destination.transaction.transactionHash !== c.destinationTransactionHash ||
    destination.transaction.rpcOrigin !== c.newDestinationDeployment.rpcOrigin || !same(destination.transaction.block, c.destinationBlock) ||
    !finalized(destination.transaction, c.destinationSafeBlock) ||
    hashObject({ ...destination.transaction, safeBlock: null }) !== c.destinationTransactionProofHash) blocked("destination_transaction_mismatch");
  if (!same(destinationDeployment, c.newDestinationDeployment) || !same(destinationDeployment.block, destination.transaction.block)) blocked("destination_deployment_mismatch");
  let parsedDestination;
  try { parsedDestination = bridgeDestinationProof(parsedSource, operation.intent.materialization, operation.intent.decoded, destination.receipt); }
  catch { return blocked("destination_correlation_mismatch"); }
  if (parsedDestination.transactionHash !== c.destinationTransactionHash || parsedDestination.blockNumberAtomic !== c.destinationBlock.numberAtomic ||
    parsedDestination.blockHash !== c.destinationBlock.hash || parsedDestination.recipient !== c.route.recipient ||
    parsedDestination.token !== c.route.toToken || parsedDestination.amountAtomic !== c.route.outputAmountAtomic) blocked("destination_correlation_mismatch");
  return { ...parsedDestination, safeBlock: destinationFinalityBlock, rpcOrigin: c.newDestinationDeployment.rpcOrigin,
    transactionProofHash: c.destinationTransactionProofHash };
}

export function migrateBaseDeploymentOperation(operation: BridgeOperationRecord, destinationProof?: BridgeVerifiedDestinationProof): {
  readonly operation: BridgeOperationRecord; readonly previousOperation: BridgeOperationRecord;
  readonly audit: BaseDeploymentMigrationAudit; readonly alreadyCurrent: boolean;
} {
  const current = hasCurrentShape(operation);
  if (current) validateBridgeOperation(operation); else validateLegacyBridgeOperation(operation);
  assertCandidate(operation, current);
  if (current) {
    const original = resealBase(operation, false);
    assertOldDigest(original);
    return { operation, previousOperation: original, audit: auditFor(original, operation), alreadyCurrent: true };
  }
  if (destinationProof === undefined || destinationProof.transactionHash !== BASE_DEPLOYMENT_MIGRATION_CANDIDATE.destinationTransactionHash ||
    destinationProof.transactionProofHash !== BASE_DEPLOYMENT_MIGRATION_CANDIDATE.destinationTransactionProofHash) blocked("destination_proof_missing");
  const migrated = resealBase(operation, true, destinationProof);
  return { operation: migrated, previousOperation: operation, audit: auditFor(operation, migrated), alreadyCurrent: false };
}

function hasCurrentShape(operation: BridgeOperationRecord): boolean {
  return Object.hasOwn(operation.intent, "allowlist") && Object.hasOwn(operation, "usageLease") &&
    operation.transitions.every((entry) => Object.hasOwn(entry, "usageLease"));
}
function assertOldDigest(operation: BridgeOperationRecord): void {
  const c = BASE_DEPLOYMENT_MIGRATION_CANDIDATE;
  if (operation.fingerprint !== c.oldFingerprint || operation.integrityHash !== c.oldIntegrityHash ||
    operation.transitions.at(-1)?.transitionHash !== c.oldTransitionRoot) blocked("old_digest_mismatch");
}
function assertCandidate(operation: BridgeOperationRecord, current: boolean): void {
  const c = BASE_DEPLOYMENT_MIGRATION_CANDIDATE, r = operation.intent.materialization.request;
  if (operation.operationId !== c.operationId || operation.profileHash !== c.profileHash ||
    (current ? !operation.terminal || operation.state !== "completed" : operation.terminal || operation.state !== "unknown_finality")) blocked("operation_identity_mismatch");
  if (r.fromChainId !== c.route.fromChainId || r.toChainId !== c.route.toChainId || r.fromToken !== c.route.fromToken ||
    r.toToken !== c.route.toToken || r.amountAtomic !== c.route.amountAtomic || r.recipient !== c.route.recipient ||
    operation.intent.materialization.tool !== c.route.tool) blocked("route_mismatch");
  const expectedSource = c.oldSourceDeployment;
  const expectedDestination = current ? c.newDestinationDeployment : c.oldDestinationDeployment;
  if (!same(operation.intent.sourceDeployment, expectedSource) || !same(operation.intent.destinationDeployment, expectedDestination) ||
    operation.intent.sourceRpcOrigin !== expectedSource.rpcOrigin || operation.intent.destinationRpcOrigin !== expectedDestination.rpcOrigin) blocked("deployment_mismatch");
  if (!current) assertOldDigest(operation);
  if ((current ? operation.destinationProof?.transactionHash !== c.destinationTransactionHash : operation.destinationProof !== null) ||
    operation.sourceProof === null || operation.effects.length !== 2 ||
    operation.effects[0]?.role !== "approval" || operation.effects[0].transactionHash !== c.approvalTransactionHash ||
    operation.effects[1]?.role !== "bridge" || operation.effects[1].transactionHash !== c.sourceTransactionHash ||
    operation.effects.some((effect) => effect.submissionAttempts !== 1 || effect.phase !== "safe_success" || effect.safeProof === null) ||
    operation.sourceProof.transactionHash !== c.sourceTransactionHash || operation.sourceProof.sourceAmountAtomic !== c.route.amountAtomic ||
    operation.sourceProof.bridgeAmountAtomic !== c.route.bridgeAmountAtomic || operation.providerObservation?.status !== "completed_observed" ||
    operation.providerObservation.destinationTransactionHash !== c.destinationTransactionHash) blocked("operation_evidence_mismatch");
  if (current && (operation.fingerprint !== c.newFingerprint || operation.integrityHash !== c.newIntegrityHash ||
    operation.transitions.at(-1)?.transitionHash !== c.newTransitionRoot)) blocked("new_digest_mismatch");
}

function resealBase(operation: BridgeOperationRecord, current: boolean, destinationProof?: BridgeVerifiedDestinationProof): BridgeOperationRecord {
  const c = BASE_DEPLOYMENT_MIGRATION_CANDIDATE, draft: any = structuredClone(operation);
  if (!current) {
    const restored = draft.transitions.at(-2);
    if (restored === undefined) blocked("migration_transition_missing");
    draft.transitions.pop(); draft.updatedAt = restored.at; draft.terminal = false;
    for (const key of ["state", "approval", "sourceProof", "destinationProof", "providerObservation", "destinationScan", "failure", "usageLease"] as const) {
      draft[key] = structuredClone(restored[key]);
    }
  }
  const source = c.oldSourceDeployment;
  const destination = current ? c.newDestinationDeployment : c.oldDestinationDeployment;
  draft.intent.sourceDeployment = source; draft.intent.destinationDeployment = destination;
  draft.intent.sourceRpcOrigin = source.rpcOrigin; draft.intent.destinationRpcOrigin = destination.rpcOrigin;
  draft.intent.sourceAccount.rpcOrigin = source.rpcOrigin;
  if (current) { draft.intent.allowlist = null; draft.usageLease = null; }
  else { delete draft.intent.allowlist; delete draft.usageLease; }
  const newFingerprint = hashObject(bridgeIntentBinding(draft)); draft.fingerprint = newFingerprint;
  if (draft.approval !== null) draft.approval.fingerprint = newFingerprint;
  let previousHash = newFingerprint;
  const transitions: BridgeTransition[] = draft.transitions.map((entry: any) => {
    const body: any = structuredClone(entry); delete body.transitionHash;
    if (current) body.usageLease = null; else delete body.usageLease;
    if (body.approval !== null) body.approval.fingerprint = newFingerprint;
    body.previousHash = previousHash;
    const sealed = { ...body, transitionHash: hashObject(body) } as BridgeTransition;
    previousHash = sealed.transitionHash; return sealed;
  });
  if (current) {
    draft.state = "completed"; draft.terminal = true; draft.destinationProof = destinationProof;
    draft.failure = { reason: "delivery_correlated", residualAllowance: null };
    const snapshot = bridgeSnapshot(draft as BridgeOperationRecord), body = { ...snapshot, at: draft.updatedAt, previousHash };
    const transition = { ...body, transitionHash: hashObject(body) } as BridgeTransition;
    transitions.push(transition);
  }
  delete draft.integrityHash;
  const migrated = sealBridgeOperation({ ...draft, transitions });
  if (current) validateBridgeOperation(migrated); else validateLegacyBridgeOperation(migrated);
  return migrated;
}

function auditFor(oldOperation: BridgeOperationRecord, newOperation: BridgeOperationRecord): BaseDeploymentMigrationAudit {
  const body = { schemaVersion: BASE_DEPLOYMENT_MIGRATION_SCHEMA, operationId,
    candidateHash: hashObject(BASE_DEPLOYMENT_MIGRATION_CANDIDATE), sourceTransactionHash, destinationTransactionHash,
    oldFingerprint: oldOperation.fingerprint, newFingerprint: newOperation.fingerprint,
    oldIntegrityHash: oldOperation.integrityHash, newIntegrityHash: newOperation.integrityHash,
    oldTransitionRoot: oldOperation.transitions.at(-1)!.transitionHash, newTransitionRoot: newOperation.transitions.at(-1)!.transitionHash,
    touchedFields: ["intent.destinationDeployment", "intent.destinationRpcOrigin", "intent.allowlist", "usageLease", "transitions[].usageLease", "state",
      "terminal", "destinationProof", "failure", "fingerprint", "approval.fingerprint", "transitions[].approval.fingerprint",
      "transitions[].previousHash", "transitions[].transitionHash", "transitions[]", "integrityHash"] as const };
  return { ...body, auditDigest: hashObject(body) };
}
function word(address: string): string { return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`; }
