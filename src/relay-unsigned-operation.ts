/** An immutable Relay quote projection. Its transactions are unsigned and have no execution path. */
import { hashObject, sha256 } from "./canonical.js";
import type { ValidatedRelayQuote } from "./relay/quote.js";
import { ETHEREUM_USDC, relayStatusLocator } from "./relay/quote.js";
import { relayNativeRoute, type ValidatedRelayNativeQuote } from "./relay/native-quote.js";
import { RELAY_ARBITRUM_USDC, validateRelayArbitrumUsdcEthereumUsdcQuote } from "./relay/arbitrum-usdc-ethereum-quote.js";
import type { RelayArbitrumSourceDraft } from "./relay/arbitrum-usdc-source-draft.js";
import { ApnError } from "./errors.js";
import { SecureStateStore, stateIdentifier } from "./secure-state-store.js";
import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/u);
const positiveAtomic = z.string().regex(/^[1-9][0-9]*$/u);
const timestamp = z.string().datetime({ offset: true });
const body = z.strictObject({
  schemaVersion: z.literal("apn.relay-unsigned-operation.v1"),
  kind: z.literal("relay_unsigned"),
  state: z.literal("prepared"),
  terminal: z.literal(false),
  profileHash: hash,
  operationId: hash,
  idempotencyHash: hash,
  requestHash: hash,
  sourceChainId: z.union([z.literal(1), z.literal(56), z.literal(42161)]),
  destinationChainId: z.union([z.literal(1), z.literal(56), z.literal(137), z.literal(143), z.literal(8453)]),
  sourceAccount: address,
  recipient: address,
  quoteDigest: hash,
  statusLocator: z.strictObject({ requestId: z.string(), endpoint: z.string() }).optional(),
  quote: z.custom<ValidatedRelayQuote>((value) => value !== null && typeof value === "object" && !Array.isArray(value)).optional(),
  nativeQuote: z.custom<ValidatedRelayNativeQuote>((value) => value !== null && typeof value === "object" && !Array.isArray(value)).optional(),
  arbitrumDraft: z.custom<RelayArbitrumSourceDraft>((value) => value !== null && typeof value === "object" && !Array.isArray(value)).optional(),
  policyDigest: hash.optional(),
  policyRevision: z.number().int().positive().optional(),
  approvalNetworkFeeCeilingWei: positiveAtomic.optional(),
  depositNetworkFeeCeilingWei: positiveAtomic.optional(),
  amountAtomic: positiveAtomic,
  minOutputAtomic: positiveAtomic,
  createdAt: timestamp,
  deadline: timestamp,
});
const schema = body.safeExtend({ integrityHash: hash });
export type RelayUnsignedOperation = z.infer<typeof schema>;
export type RelayUnsignedOperationInput = z.infer<typeof body>;
const retirementBody = z.strictObject({ schemaVersion: z.literal("apn.relay-retirement.v1"),
  profileHash: hash, operationId: hash, preparedIntegrityHash: hash, retiredAt: timestamp });
const retirementSchema = retirementBody.safeExtend({ integrityHash: hash });
export type RelayRetirement = z.infer<typeof retirementSchema>;

function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "Relay unsigned operation is invalid."); }

export function validateRelayUnsignedOperation(value: unknown): RelayUnsignedOperation {
  const parsed = schema.safeParse(value);
  if (!parsed.success) corrupt();
  const operation = parsed.data;
  const { integrityHash, ...fields } = operation;
  if (hashObject(fields) !== integrityHash || Date.parse(operation.deadline) <= Date.parse(operation.createdAt)) corrupt();
  if ([operation.quote, operation.policyDigest, operation.policyRevision,
    operation.approvalNetworkFeeCeilingWei, operation.depositNetworkFeeCeilingWei].some(value => value !== undefined) &&
    operation.nativeQuote === undefined && operation.arbitrumDraft === undefined &&
    [operation.quote, operation.policyDigest, operation.policyRevision,
      operation.approvalNetworkFeeCeilingWei, operation.depositNetworkFeeCeilingWei].some(value => value === undefined)) corrupt();
  if (operation.arbitrumDraft !== undefined) {
    const draft = operation.arbitrumDraft;
    try {
      const { integrityHash: draftHash, ...draftBody } = draft;
      if (hashObject(draftBody) !== draftHash || draft.schemaVersion !== "apn.relay-arbitrum-source-draft.v1" ||
        draft.executionAdmitted !== false || draft.nextActions.length !== 0 ||
        operation.quote !== undefined || operation.nativeQuote !== undefined ||
        operation.sourceChainId !== 42161 || operation.destinationChainId !== 1 ||
        operation.profileHash !== sha256(`profile\0${draft.profile}`) ||
        operation.sourceAccount !== draft.owner || operation.recipient !== draft.recipient.toLowerCase() ||
        operation.quoteDigest !== draft.quoteDigest || operation.amountAtomic !== draft.amountAtomic ||
        operation.minOutputAtomic !== draft.minimumOutputAtomic ||
        operation.policyDigest !== draft.policyDigest || operation.policyRevision !== draft.policyRevision ||
        operation.approvalNetworkFeeCeilingWei !== draft.maxApprovalNetworkFeeWei ||
        operation.depositNetworkFeeCeilingWei !== draft.maxDepositNetworkFeeWei ||
        operation.createdAt !== draft.createdAt || operation.deadline !== draft.deadline ||
        operation.statusLocator?.requestId !== draft.requestId ||
        relayStatusLocator(draft.requestId, operation.statusLocator.endpoint).endpoint !== operation.statusLocator.endpoint) corrupt();
    } catch { corrupt(); }
  } else if (operation.nativeQuote !== undefined) {
    const quote = operation.nativeQuote;
    let route: ReturnType<typeof relayNativeRoute>;
    try { route = relayNativeRoute(operation.sourceAccount, operation.recipient); } catch { return corrupt(); }
    if (operation.quote !== undefined || operation.sourceChainId !== 56 || operation.destinationChainId !== route.chainId ||
      operation.sourceAccount.toLowerCase() !== route.payer.toLowerCase() ||
      quote.routeReference !== route.reference || quote.schemaVersion !== "apn.relay-native-quote.v1" ||
      operation.approvalNetworkFeeCeilingWei !== undefined || operation.policyDigest === undefined ||
      operation.policyRevision === undefined || operation.depositNetworkFeeCeilingWei === undefined ||
      quote.payer !== operation.sourceAccount.toLowerCase() || quote.recipient !== operation.recipient.toLowerCase() ||
      quote.principalAtomic !== operation.amountAtomic || quote.minimumOutputWei !== operation.minOutputAtomic ||
      new Date(quote.deadline * 1000).toISOString() !== operation.deadline ||
      quote.deposit.maximumNetworkFeeWei !== operation.depositNetworkFeeCeilingWei ||
      quote.quoteDigest !== operation.quoteDigest ||
      hashObject((({ quoteDigest: _digest, ...projection }) => projection)(quote)) !== quote.quoteDigest ||
      (quote.statusLocator === undefined) !== (operation.statusLocator === undefined) ||
      (operation.statusLocator !== undefined && (quote.statusLocator?.requestId !== operation.statusLocator.requestId ||
        quote.statusLocator?.endpoint !== operation.statusLocator.endpoint ||
        relayStatusLocator(operation.statusLocator.requestId, operation.statusLocator.endpoint).endpoint !== operation.statusLocator.endpoint))) corrupt();
  } else if (operation.sourceChainId !== 1 || ![56, 8453].includes(operation.destinationChainId) ||
    (operation.destinationChainId === 8453 && operation.quote === undefined)) corrupt();
  if (operation.quote !== undefined) {
    try {
      const { quoteDigest, ...projection } = operation.quote;
      if (hashObject(projection) !== quoteDigest || quoteDigest !== operation.quoteDigest ||
        (operation.quote.statusLocator === undefined) !== (operation.statusLocator === undefined) ||
        (operation.statusLocator !== undefined &&
          (relayStatusLocator(operation.statusLocator.requestId, operation.statusLocator.endpoint).endpoint !== operation.statusLocator.endpoint ||
            operation.quote.statusLocator?.requestId !== operation.statusLocator.requestId ||
            operation.quote.statusLocator?.endpoint !== operation.statusLocator.endpoint)) ||
        operation.quote.payer !== operation.sourceAccount.toLowerCase() ||
        operation.quote.recipient !== operation.recipient.toLowerCase() ||
        operation.quote.orderData.output.chainId !== (operation.destinationChainId === 8453 ? "base" : "bnb") ||
        operation.quote.routeReference !== (operation.destinationChainId === 8453 ? "ethereum-usdc-base-eth-v1" : undefined) ||
        operation.quote.paymentDetails.chainId !== "ethereum" ||
        operation.quote.principalAtomic !== operation.amountAtomic ||
        operation.quote.minimumOutputWei !== operation.minOutputAtomic ||
        new Date(operation.quote.deadline * 1000).toISOString() !== operation.deadline ||
        operation.approvalNetworkFeeCeilingWei !== operation.quote.approval.maximumNetworkFeeWei ||
        operation.depositNetworkFeeCeilingWei !== operation.quote.deposit.maximumNetworkFeeWei) corrupt();
    } catch { corrupt(); }
  } else if (operation.statusLocator !== undefined && operation.nativeQuote === undefined &&
    operation.arbitrumDraft === undefined) corrupt();
  return operation;
}

export function freezeRelayUnsignedOperation(input: RelayUnsignedOperationInput): RelayUnsignedOperation {
  const parsed = body.safeParse(input);
  if (!parsed.success) corrupt();
  return validateRelayUnsignedOperation({ ...parsed.data, integrityHash: hashObject(parsed.data) });
}

export type PublicRelayUnsignedOperation = Omit<RelayUnsignedOperation,
  "integrityHash" | "statusLocator" | "quote" | "nativeQuote" | "arbitrumDraft" | "state" | "terminal"> & {
  readonly quote?: Omit<ValidatedRelayQuote, "statusLocator">;
  readonly nativeQuote?: Omit<ValidatedRelayNativeQuote, "statusLocator">;
  readonly arbitrumSource?: Readonly<{ readonly orderId: string; readonly providerFeeCeilingAtomic: string;
    readonly routeReference: "arbitrum-usdc-ethereum-usdc-source-draft-v1" }>;
  readonly state: "prepared" | "retired" | "source_confirmed";
  readonly terminal: boolean;
  readonly sourceEffectTerminal?: true;
  readonly sourceJournalIntegrityHash?: string;
  readonly retiredAt?: string;
  readonly retirementIntegrityHash?: string;
  readonly proofClass: "saved_unsigned_quote" | "source_effect_confirmed";
  readonly balanceEvidence: "not_checked";
  readonly allowanceEvidence: "not_checked";
  readonly statusObservable: boolean;
  readonly executionAdmitted: false;
  readonly nextActions: readonly [];
};

export function publicRelayUnsignedOperation(operation: RelayUnsignedOperation,
  retirement: RelayRetirement | null = null,
  sourceCompletion: { readonly journalIntegrityHash: string } | null = null): PublicRelayUnsignedOperation {
  const { integrityHash: _integrityHash, statusLocator: _locator, quote, nativeQuote, arbitrumDraft,
    ...publicFields } = validateRelayUnsignedOperation(operation);
  const publicQuote = quote === undefined ? {} : { quote: (({ statusLocator: _hidden, ...fields }) => fields)(quote) };
  const publicNativeQuote = nativeQuote === undefined ? {} : {
    nativeQuote: (({ statusLocator: _hidden, ...fields }) => fields)(nativeQuote),
  };
  return { ...publicFields, ...publicQuote, ...publicNativeQuote,
    ...(arbitrumDraft === undefined ? {} : { arbitrumSource: { orderId: arbitrumDraft.orderId,
      providerFeeCeilingAtomic: arbitrumDraft.maxProviderFeeAtomic,
      routeReference: "arbitrum-usdc-ethereum-usdc-source-draft-v1" as const } }),
    ...(retirement === null ? {} : { state: "retired" as const, terminal: true as const,
    retiredAt: retirement.retiredAt, retirementIntegrityHash: retirement.integrityHash }),
    ...(sourceCompletion === null ? {} : { state: "source_confirmed" as const, terminal: true as const,
      sourceEffectTerminal: true as const, sourceJournalIntegrityHash: sourceCompletion.journalIntegrityHash }),
    proofClass: sourceCompletion === null ? "saved_unsigned_quote" as const : "source_effect_confirmed" as const,
    balanceEvidence: "not_checked" as const,
    allowanceEvidence: "not_checked" as const, statusObservable: operation.statusLocator !== undefined,
    executionAdmitted: false as const, nextActions: [] as const };
}

/** Separate create-only marker preserves the original prepared quote byte for byte. */
export class RelayRetirementRepository extends SecureStateStore {
  private path(profileHash: string, operationId: string): string {
    stateIdentifier(profileHash, "Relay retirement profile"); stateIdentifier(operationId, "Relay retirement operation");
    return `relay-retirements/${profileHash}/${operationId}.json`;
  }
  async load(operation: RelayUnsignedOperation): Promise<RelayRetirement | null> {
    validateRelayUnsignedOperation(operation);
    const value = await this.readJson(this.path(operation.profileHash, operation.operationId));
    if (value === null) return null;
    const parsed = retirementSchema.safeParse(value);
    if (!parsed.success) corrupt();
    const { integrityHash, ...fields } = parsed.data;
    if (hashObject(fields) !== integrityHash || fields.profileHash !== operation.profileHash ||
      fields.operationId !== operation.operationId || fields.preparedIntegrityHash !== operation.integrityHash ||
      new Date(fields.retiredAt).toISOString() !== fields.retiredAt ||
      Date.parse(fields.retiredAt) < Date.parse(operation.createdAt)) corrupt();
    return parsed.data;
  }
  /** Caller holds profile and operation locks and has checked all effect stores. */
  async persistLocked(operation: RelayUnsignedOperation, retiredAt: string): Promise<RelayRetirement> {
    const existing = await this.load(operation);
    if (existing !== null) return existing;
    if (Number.isNaN(Date.parse(retiredAt)) || new Date(retiredAt).toISOString() !== retiredAt ||
      Date.parse(retiredAt) < Date.parse(operation.createdAt)) {
      throw new ApnError("APN_INVALID_INPUT", "Relay retirement time is invalid.");
    }
    const fields = { schemaVersion: "apn.relay-retirement.v1" as const, profileHash: operation.profileHash,
      operationId: operation.operationId, preparedIntegrityHash: operation.integrityHash, retiredAt };
    const marker = retirementSchema.parse({ ...fields, integrityHash: hashObject(fields) });
    await this.initialize(); await this.ensureDirectory(`relay-retirements/${operation.profileHash}`);
    await this.writeJson(this.path(operation.profileHash, operation.operationId), marker, true);
    return marker;
  }
}

export class RelayUnsignedOperationRepository extends SecureStateStore {
  private async verifyArbitrumDraft(operation: RelayUnsignedOperation): Promise<void> {
    const draft = operation.arbitrumDraft;
    if (draft === undefined) return;
    try {
      const quote = await validateRelayArbitrumUsdcEthereumUsdcQuote(draft.rawQuote, {
        payer: draft.owner, amountAtomic: draft.amountAtomic,
        minimumOutputAtomic: draft.minimumOutputAtomic,
        nowSeconds: Math.floor(Date.parse(draft.createdAt) / 1000),
      });
      if (draft.sourceChainId !== 42161 || draft.destinationChainId !== 1 ||
        draft.sourceToken.toLowerCase() !== RELAY_ARBITRUM_USDC.toLowerCase() ||
        draft.destinationToken.toLowerCase() !== ETHEREUM_USDC.toLowerCase() ||
        draft.quoteDigest !== quote.quoteDigest || draft.orderId !== quote.orderId ||
        draft.requestId !== quote.statusLocator.requestId || draft.recipient.toLowerCase() !== quote.recipient ||
        draft.minimumOutputAtomic !== quote.minimumOutputAtomic ||
        new Date(quote.deadline * 1000).toISOString() !== draft.deadline ||
        BigInt(quote.providerFeeAtomic) > BigInt(draft.maxProviderFeeAtomic) ||
        BigInt(quote.approval.maximumNetworkFeeWei) > BigInt(draft.maxApprovalNetworkFeeWei) ||
        BigInt(quote.deposit.maximumNetworkFeeWei) > BigInt(draft.maxDepositNetworkFeeWei)) corrupt();
    } catch { corrupt(); }
  }

  async loadOperation(profileHash: string, operationId: string): Promise<RelayUnsignedOperation | null> {
    const value = await this.readJson(this.path(profileHash, operationId));
    if (value === null) return null;
    const operation = validateRelayUnsignedOperation(value);
    if (operation.profileHash !== profileHash || operation.operationId !== operationId) corrupt();
    await this.verifyArbitrumDraft(operation);
    return operation;
  }

  async findOperation(operationId: string): Promise<RelayUnsignedOperation | null> {
    stateIdentifier(operationId, "Relay unsigned operation ID");
    const matches = (await this.listAllOperations()).filter((operation) => operation.operationId === operationId);
    if (matches.length > 1) corrupt();
    return matches[0] ?? null;
  }

  async listOperations(profileHash: string): Promise<readonly RelayUnsignedOperation[]> {
    stateIdentifier(profileHash, "Relay unsigned profile hash");
    const result: RelayUnsignedOperation[] = [];
    for (const entry of await this.readDirectory(`relay-unsigned-operations/${profileHash}`)) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^[a-f0-9]{64}\.json$/u.test(entry.name)) corrupt();
      const operation = await this.loadOperation(profileHash, entry.name.slice(0, -5));
      if (operation === null) corrupt();
      result.push(operation);
    }
    return result;
  }

  async listAllOperations(): Promise<readonly RelayUnsignedOperation[]> {
    const result: RelayUnsignedOperation[] = [];
    for (const entry of await this.readDirectory("relay-unsigned-operations")) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-f0-9]{64}$/u.test(entry.name)) corrupt();
      result.push(...await this.listOperations(entry.name));
    }
    if (new Set(result.map((operation) => operation.operationId)).size !== result.length) corrupt();
    return result;
  }

  /** Caller holds the shared profile, operation ID, and idempotency locks and checks all money stores. */
  async persistLocked(operation: RelayUnsignedOperation): Promise<void> {
    validateRelayUnsignedOperation(operation);
    await this.verifyArbitrumDraft(operation);
    const previous = await this.loadOperation(operation.profileHash, operation.operationId);
    if (previous !== null) {
      if (previous.integrityHash !== operation.integrityHash) throw new ApnError("APN_IDEMPOTENCY_CONFLICT", "Relay unsigned operation cannot be changed.");
      return;
    }
    await this.initialize();
    await this.ensureDirectory(`relay-unsigned-operations/${operation.profileHash}`);
    await this.writeJson(this.path(operation.profileHash, operation.operationId), operation, true);
  }

  private path(profileHash: string, operationId: string): string {
    stateIdentifier(profileHash, "Relay unsigned profile hash");
    stateIdentifier(operationId, "Relay unsigned operation ID");
    return `relay-unsigned-operations/${profileHash}/${operationId}.json`;
  }
}
