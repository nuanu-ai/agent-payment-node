import { exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { BASE_USDC, CHAIN_ID, STATE_VERSION, USDC_DECIMALS } from "./constants.js";
import { ApnError } from "./errors.js";
import { formatAtomic, parseAtomic } from "./money.js";
import type {
  OperationRecord,
  OperationState,
  ProviderDirectBinding,
  ProviderEffectReference,
  ReceiptRecord,
  Transition,
  WalletRecord,
} from "./model.js";

const ZERO_HASH = "0".repeat(64);

export function appendTransition(
  previous: readonly Transition[],
  input: {
    readonly at: string;
    readonly state: OperationState;
    readonly terminal: boolean;
    readonly reason: string;
    readonly proofClass: string;
  },
): readonly Transition[] {
  const last = previous.at(-1);
  const body: Omit<Transition, "hash"> = {
    sequence: (BigInt(last?.sequence ?? "0") + 1n).toString(),
    at: input.at,
    state: input.state,
    terminal: input.terminal,
    reason: input.reason,
    proofClass: input.proofClass,
    previousHash: last?.hash ?? ZERO_HASH,
  };
  return [...previous, { ...body, hash: hashObject(body) }];
}

export function sealWallet(value: Omit<WalletRecord, "integrityHash">): WalletRecord {
  return { ...value, integrityHash: hashObject(value) };
}

export function sealOperation(value: Omit<OperationRecord, "integrityHash">): OperationRecord {
  return { ...value, integrityHash: hashObject(value) };
}

export function sealReceipt(value: Omit<ReceiptRecord, "integrityHash">): ReceiptRecord {
  return { ...value, integrityHash: hashObject(value) };
}

export function validateWallet(value: unknown): WalletRecord {
  if (!isPlainRecord(value) || !exactKeys(value, [
    "schemaVersion", "profile", "profileHash", "address", "createdAt", "bindingHash", "integrityHash",
  ])) stateCorrupt("Wallet state has an unexpected schema.");
  const wallet = value as unknown as WalletRecord;
  if (
    wallet.schemaVersion !== STATE_VERSION || typeof wallet.profile !== "string" ||
    typeof wallet.profileHash !== "string" || typeof wallet.address !== "string" ||
    typeof wallet.createdAt !== "string" || typeof wallet.bindingHash !== "string" ||
    wallet.integrityHash !== hashObject(withoutIntegrity(wallet))
  ) stateCorrupt("Wallet state integrity validation failed.");
  return wallet;
}

export function validateOperation(value: unknown): OperationRecord {
  if (!isPlainRecord(value)) stateCorrupt("Operation state is not an object.");
  const requiredKeys = [
    "schemaVersion", "operationId", "idempotencyHash", "profile", "profileHash", "requestHash",
    "fingerprint", "walletAddress", "recipient", "amountAtomic", "amountDecimal", "chainId", "token",
    "preparedAt", "expiresAt", "state", "terminal", "reason",
    "proofClass", "transitions", "integrityHash",
  ];
  const optionalKeys = [
    "transactionData", "economics", "preparedBlockNumberAtomic", "providerDirect", "providerEffect",
    "transactionHash", "rawTransactionHash", "lastSubmissionAt",
  ];
  const actualKeys = Object.keys(value);
  if (
    requiredKeys.some((key) => !actualKeys.includes(key)) ||
    actualKeys.some((key) => !requiredKeys.includes(key) && !optionalKeys.includes(key))
  ) stateCorrupt("Operation state has an unexpected schema.");
  const operation = value as unknown as OperationRecord;
  if (operation.schemaVersion !== STATE_VERSION || !Array.isArray(operation.transitions)) {
    stateCorrupt("Operation state has an unexpected schema.");
  }
  validateTransitions(operation.transitions);
  if (operation.integrityHash !== hashObject(withoutIntegrity(operation))) {
    stateCorrupt("Operation state integrity validation failed.");
  }
  const last = operation.transitions.at(-1);
  if (
    last === undefined || last.state !== operation.state || last.terminal !== operation.terminal ||
    last.reason !== operation.reason || last.proofClass !== operation.proofClass
  ) stateCorrupt("Operation summary does not match its transition chain.");
  parseAtomic(operation.amountAtomic, { positive: true });
  if (
    operation.amountDecimal !== formatAtomic(operation.amountAtomic, USDC_DECIMALS) || operation.chainId !== CHAIN_ID ||
    operation.token !== BASE_USDC || !/^0x[0-9a-fA-F]{40}$/u.test(operation.walletAddress) ||
    !/^0x[0-9a-fA-F]{40}$/u.test(operation.recipient)
  ) stateCorrupt("Operation frozen transfer identity is invalid.");
  if (operation.providerDirect === undefined) validateLocalDirect(operation);
  else validateProviderDirect(operation, operation.providerDirect);
  return operation;
}

export function validateReceipt(value: unknown): ReceiptRecord {
  if (!isPlainRecord(value)) stateCorrupt("Receipt state is not an object.");
  const requiredKeys = [
    "schemaVersion", "operationId", "state", "terminal", "reason", "proofClass", "createdAt",
    "operationIntegrityHash", "integrityHash",
  ];
  const optionalKeys = ["transactionHash", "blockNumberAtomic", "exactTransferLog"];
  const actualKeys = Object.keys(value);
  if (
    requiredKeys.some((key) => !actualKeys.includes(key)) ||
    actualKeys.some((key) => !requiredKeys.includes(key) && !optionalKeys.includes(key))
  ) stateCorrupt("Receipt state has an unexpected schema.");
  const receipt = value as unknown as ReceiptRecord;
  if (receipt.schemaVersion !== STATE_VERSION || receipt.integrityHash !== hashObject(withoutIntegrity(receipt))) {
    stateCorrupt("Receipt integrity validation failed.");
  }
  return receipt;
}

function validateTransitions(values: readonly Transition[]): void {
  let previousHash = ZERO_HASH;
  let sequence = 1n;
  for (const transition of values) {
    if (!isPlainRecord(transition) || !exactKeys(transition, [
      "sequence", "at", "state", "terminal", "reason", "proofClass", "previousHash", "hash",
    ])) stateCorrupt("Operation transition has an unexpected schema.");
    if (transition.sequence !== sequence.toString() || transition.previousHash !== previousHash) {
      stateCorrupt("Operation transition chain is discontinuous.");
    }
    if (transition.hash !== hashObject(transitionBody(transition))) {
      stateCorrupt("Operation transition hash is invalid.");
    }
    previousHash = transition.hash;
    sequence += 1n;
  }
  if (values.length === 0) stateCorrupt("Operation has no transition history.");
}

function validateLocalDirect(operation: OperationRecord): void {
  if (
    operation.transactionData === undefined || operation.economics === undefined ||
    operation.preparedBlockNumberAtomic === undefined || operation.providerEffect !== undefined
  ) {
    stateCorrupt("Local direct operation is missing its transaction economics.");
  }
  parseAtomic(operation.preparedBlockNumberAtomic);
  parseAtomic(operation.economics.nonceAtomic);
  parseAtomic(operation.economics.gasLimitAtomic, { positive: true });
  parseAtomic(operation.economics.maxFeePerGasAtomic, { positive: true });
  parseAtomic(operation.economics.maxPriorityFeePerGasAtomic);
  parseAtomic(operation.economics.maximumGasCostAtomic, { positive: true });
}

function validateProviderDirect(operation: OperationRecord, binding: ProviderDirectBinding): void {
  if (
    operation.transactionData !== undefined || operation.economics !== undefined ||
    operation.preparedBlockNumberAtomic !== undefined || operation.rawTransactionHash !== undefined ||
    !isPlainRecord(binding) || !exactKeys(binding, [
      "schemaVersion", "providerId", "profileRevision", "capabilityHash", "accountBindingHash", "executionMode",
      "executionOwner", "retryOwner", "rpcBindingHash", "rpcOriginHash", "policy",
    ]) || binding.schemaVersion !== "apn.provider-direct.v1" ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(binding.providerId) ||
    !Number.isSafeInteger(binding.profileRevision) || binding.profileRevision < 1 ||
    !/^[a-f0-9]{64}$/u.test(binding.capabilityHash) || !/^[a-f0-9]{64}$/u.test(binding.accountBindingHash) ||
    binding.executionMode !== "provider_atomic_send" || binding.executionOwner !== "provider" ||
    binding.retryOwner !== "apn_outer_no_replay_journal" ||
    !/^[a-f0-9]{64}$/u.test(binding.rpcBindingHash) || !/^[a-f0-9]{64}$/u.test(binding.rpcOriginHash) ||
    !isPlainRecord(binding.policy) || !exactKeys(binding.policy, ["identity", "verdict", "foregroundApprovalRequired"]) ||
    binding.policy.identity !== "apn.direct.foreground-approval.v1" ||
    binding.policy.verdict !== "foreground_approval_required" || binding.policy.foregroundApprovalRequired !== true
  ) stateCorrupt("Provider direct operation binding is invalid.");
  const providerStates: readonly OperationState[] = [
    "awaiting_approval", "started", "provider_pending", "provider_acknowledged", "evidence_pending", "ambiguous_effect",
    "completed", "failed_before_effect", "failed_provider_rejected", "failed_confirmed_revert",
  ];
  if (!providerStates.includes(operation.state)) stateCorrupt("Provider direct operation state is invalid.");
  const terminalStates: readonly OperationState[] = [
    "completed", "failed_before_effect", "failed_provider_rejected", "failed_confirmed_revert",
  ];
  if (operation.terminal !== terminalStates.includes(operation.state)) {
    stateCorrupt("Provider direct terminal posture is invalid.");
  }
  if (
    (["provider_acknowledged", "evidence_pending", "completed", "failed_confirmed_revert"] as readonly OperationState[])
      .includes(operation.state) && operation.transactionHash === undefined
  ) stateCorrupt("Provider direct transaction identity is inconsistent with state.");
  if (
    (["awaiting_approval", "started", "provider_pending", "failed_before_effect", "failed_provider_rejected"] as readonly OperationState[])
      .includes(operation.state) &&
    operation.transactionHash !== undefined
  ) stateCorrupt("Provider direct pre-effect state has a transaction identity.");
  if (operation.providerEffect !== undefined) validateProviderEffectReference(operation.providerEffect);
  if (operation.state === "provider_pending" && operation.providerEffect === undefined) {
    stateCorrupt("Provider-pending operation has no durable recovery reference.");
  }
  if (operation.state === "awaiting_approval" && operation.providerEffect !== undefined) {
    stateCorrupt("Provider request exists before foreground approval.");
  }
  const allowed: Readonly<Record<string, readonly OperationState[]>> = {
    awaiting_approval: ["started", "failed_before_effect"],
    started: ["provider_pending", "provider_acknowledged", "ambiguous_effect", "failed_before_effect", "failed_provider_rejected"],
    provider_pending: ["provider_acknowledged", "ambiguous_effect", "failed_provider_rejected"],
    provider_acknowledged: ["evidence_pending", "completed", "failed_confirmed_revert", "ambiguous_effect"],
    evidence_pending: ["completed", "failed_confirmed_revert", "ambiguous_effect"],
    ambiguous_effect: ["provider_acknowledged", "completed", "failed_provider_rejected", "failed_confirmed_revert"],
    completed: [],
    failed_before_effect: [],
    failed_provider_rejected: [],
    failed_confirmed_revert: [],
  };
  for (let index = 0; index < operation.transitions.length; index += 1) {
    const current = operation.transitions[index];
    if (current === undefined) stateCorrupt("Provider direct transition is missing.");
    if (index === 0) {
      if (current.state !== "awaiting_approval") stateCorrupt("Provider direct genesis state is invalid.");
      continue;
    }
    const previous = operation.transitions[index - 1];
    if (previous === undefined || !(allowed[previous.state] ?? []).includes(current.state)) {
      stateCorrupt("Provider direct state transition is invalid.");
    }
  }
}

function validateProviderEffectReference(reference: ProviderEffectReference): void {
  if (
    !isPlainRecord(reference) || !exactKeys(reference, ["schemaVersion", "kind", "recoveryToken", "providerState"]) ||
    reference.schemaVersion !== "apn.provider-effect-reference.v1" || reference.kind !== "transaction" ||
    typeof reference.recoveryToken !== "string" || !/^[A-Za-z0-9._:-]{1,256}$/u.test(reference.recoveryToken) ||
    typeof reference.providerState !== "string" || !/^[A-Z_]{3,64}$/u.test(reference.providerState)
  ) stateCorrupt("Provider effect recovery reference is invalid.");
}

function withoutIntegrity<T extends { readonly integrityHash: string }>(value: T): Omit<T, "integrityHash"> {
  const { integrityHash: _ignored, ...rest } = value;
  return rest;
}

function transitionBody(value: Transition): Omit<Transition, "hash"> {
  const { hash: _ignored, ...rest } = value;
  return rest;
}

function stateCorrupt(message: string): never {
  throw new ApnError("APN_STATE_CORRUPT", message);
}
