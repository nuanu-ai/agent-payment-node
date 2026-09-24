/** An immutable, unsigned Relay intent. No transaction, signature, or execution material is stored. */
import { hashObject } from "./canonical.js";
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
  sourceChainId: z.literal(1),
  destinationChainId: z.literal(56),
  sourceAccount: address,
  recipient: address,
  quoteDigest: hash,
  amountAtomic: positiveAtomic,
  minOutputAtomic: positiveAtomic,
  createdAt: timestamp,
  deadline: timestamp,
});
const schema = body.safeExtend({ integrityHash: hash });
export type RelayUnsignedOperation = z.infer<typeof schema>;
export type RelayUnsignedOperationInput = z.infer<typeof body>;

function corrupt(): never { throw new ApnError("APN_STATE_CORRUPT", "Relay unsigned operation is invalid."); }

export function validateRelayUnsignedOperation(value: unknown): RelayUnsignedOperation {
  const parsed = schema.safeParse(value);
  if (!parsed.success) corrupt();
  const operation = parsed.data;
  const { integrityHash, ...fields } = operation;
  if (hashObject(fields) !== integrityHash || Date.parse(operation.deadline) <= Date.parse(operation.createdAt)) corrupt();
  return operation;
}

export function freezeRelayUnsignedOperation(input: RelayUnsignedOperationInput): RelayUnsignedOperation {
  const parsed = body.safeParse(input);
  if (!parsed.success) corrupt();
  return validateRelayUnsignedOperation({ ...parsed.data, integrityHash: hashObject(parsed.data) });
}

export function publicRelayUnsignedOperation(operation: RelayUnsignedOperation) {
  const { integrityHash: _integrityHash, ...publicFields } = validateRelayUnsignedOperation(operation);
  return { ...publicFields, proofClass: "saved_unsigned_quote" as const, executionAdmitted: false as const, nextActions: [] as const };
}

export class RelayUnsignedOperationRepository extends SecureStateStore {
  async loadOperation(profileHash: string, operationId: string): Promise<RelayUnsignedOperation | null> {
    const value = await this.readJson(this.path(profileHash, operationId));
    if (value === null) return null;
    const operation = validateRelayUnsignedOperation(value);
    if (operation.profileHash !== profileHash || operation.operationId !== operationId) corrupt();
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
