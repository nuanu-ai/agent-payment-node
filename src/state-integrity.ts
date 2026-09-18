import { exactKeys, hashObject, isPlainRecord } from "./canonical.js";
import { BASE_USDC, CHAIN_ID, STATE_VERSION, USDC_DECIMALS } from "./constants.js";
import { ApnError } from "./errors.js";
import { validateEvmTransferEvidence } from "./direct-terminal-receipt.js";
import { validateEvmDirectBinding, validateEvmOperation } from "./evm-direct.js";
import { evmUint } from "./evm-asset.js";
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
    "transactionHash", "rawTransactionHash", "lastSubmissionAt", "evm", "coinbaseGaslessLocator",
    "coinbaseGaslessCursor", "coinbaseGaslessSettlement", "allowlist", "allowlistLease",
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
    (operation.evm === undefined && (operation.amountDecimal !== formatAtomic(operation.amountAtomic, USDC_DECIMALS) ||
    operation.chainId !== CHAIN_ID || operation.token !== BASE_USDC)) || !/^0x[0-9a-fA-F]{40}$/u.test(operation.walletAddress) ||
    !/^0x[0-9a-fA-F]{40}$/u.test(operation.recipient)
  ) stateCorrupt("Operation frozen transfer identity is invalid.");
  if (operation.evm !== undefined) validateEvmOperation(operation);
  else if (operation.allowlist !== undefined || operation.allowlistLease !== undefined) stateCorrupt("Only an explicit EVM asset operation carries a direct allowlist binding.");
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
  const optionalKeys = ["transactionHash", "blockNumberAtomic", "exactTransferLog", "evm", "amountAtomic", "evmEvidence", "coinbaseGaslessSettlement"];
  const actualKeys = Object.keys(value);
  if (
    requiredKeys.some((key) => !actualKeys.includes(key)) ||
    actualKeys.some((key) => !requiredKeys.includes(key) && !optionalKeys.includes(key))
  ) stateCorrupt("Receipt state has an unexpected schema.");
  const receipt = value as unknown as ReceiptRecord;
  if (receipt.schemaVersion !== STATE_VERSION || receipt.integrityHash !== hashObject(withoutIntegrity(receipt))) {
    stateCorrupt("Receipt integrity validation failed.");
  }
  if (receipt.evm !== undefined) {
    validateEvmDirectBinding(receipt.evm);
    evmUint(receipt.amountAtomic, true);
    if (receipt.evmEvidence !== undefined) validateEvmTransferEvidence(receipt.evmEvidence);
  } else if (receipt.amountAtomic !== undefined || receipt.evmEvidence !== undefined) stateCorrupt("Receipt asset fields have no binding.");
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
  if (operation.state === "abandoned_unknown" || operation.transitions.some((transition) => transition.state === "abandoned_unknown")) {
    stateCorrupt("Local direct operation cannot use provider owner abandonment.");
  }
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
      ...(binding.executionMode === "delegated_session_transaction" ? [
        "permissionRevision", "rootGrantFingerprint", "sessionAddress", "delegationManager", "permissionExpiresAtUnix",
      ] : binding.coinbaseGasless === undefined ? [] : ["coinbaseGasless"]),
    ]) || binding.schemaVersion !== "apn.provider-direct.v1" ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(binding.providerId) ||
    !Number.isSafeInteger(binding.profileRevision) || binding.profileRevision < 1 ||
    !/^[a-f0-9]{64}$/u.test(binding.capabilityHash) || !/^[a-f0-9]{64}$/u.test(binding.accountBindingHash) ||
    !(
      (binding.executionMode === "provider_atomic_send" && binding.executionOwner === "provider" &&
        binding.retryOwner === "apn_outer_no_replay_journal") ||
      (binding.executionMode === "delegated_session_transaction" && binding.executionOwner === "apn" &&
        binding.retryOwner === "apn_operation_state" && validDelegatedBinding(binding))
    ) ||
    !/^[a-f0-9]{64}$/u.test(binding.rpcBindingHash) || !/^[a-f0-9]{64}$/u.test(binding.rpcOriginHash) ||
    !isPlainRecord(binding.policy) || !exactKeys(binding.policy, ["identity", "verdict", "foregroundApprovalRequired"]) ||
    binding.policy.identity !== "apn.direct.foreground-approval.v1" ||
    binding.policy.verdict !== "foreground_approval_required" || binding.policy.foregroundApprovalRequired !== true
  ) stateCorrupt("Provider direct operation binding is invalid.");
  const hasCoinbaseMetadata = operation.coinbaseGaslessLocator !== undefined || operation.coinbaseGaslessCursor !== undefined ||
    operation.coinbaseGaslessSettlement !== undefined;
  if (binding.coinbaseGasless !== undefined) {
    if (binding.providerId !== "coinbase-agentic-wallet" || binding.executionMode !== "provider_atomic_send") {
      stateCorrupt("Coinbase gasless operation provider identity is invalid.");
    }
    validateCoinbaseGasless(operation, binding.coinbaseGasless);
  } else if (hasCoinbaseMetadata) stateCorrupt("Non-Coinbase operation carries Coinbase gasless metadata.");
  const providerStates: readonly OperationState[] = [
    "awaiting_approval", "started", "provider_pending", "provider_acknowledged", "evidence_pending", "ambiguous_effect",
    "abandoned_unknown", "completed", "failed_before_effect", "failed_provider_rejected", "failed_confirmed_revert",
  ];
  if (!providerStates.includes(operation.state)) stateCorrupt("Provider direct operation state is invalid.");
  const terminalStates: readonly OperationState[] = [
    "abandoned_unknown", "completed", "failed_before_effect", "failed_provider_rejected", "failed_confirmed_revert",
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
  if (operation.state === "abandoned_unknown" && (
    binding.executionMode !== "provider_atomic_send" || operation.transactionHash !== undefined ||
    operation.providerEffect !== undefined || operation.reason !== "owner_acknowledged_unresolved_effect" ||
    operation.proofClass !== "owner_acknowledgement_only"
  )) stateCorrupt("Provider direct owner abandonment classification is invalid.");
  const allowed: Readonly<Record<string, readonly OperationState[]>> = {
    awaiting_approval: ["started", "failed_before_effect"],
    started: ["provider_pending", "provider_acknowledged", "ambiguous_effect", "failed_before_effect", "failed_provider_rejected"],
    provider_pending: ["provider_acknowledged", "ambiguous_effect", "failed_provider_rejected"],
    provider_acknowledged: ["evidence_pending", "completed", "failed_confirmed_revert", "ambiguous_effect"],
    evidence_pending: ["completed", "failed_confirmed_revert", "ambiguous_effect"],
    ambiguous_effect: ["provider_pending", "provider_acknowledged", "completed", "failed_provider_rejected", "failed_confirmed_revert", "abandoned_unknown",
      ...(binding.coinbaseGasless === undefined ? [] : ["ambiguous_effect" as const])],
    abandoned_unknown: [],
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

function validateCoinbaseGasless(operation: OperationRecord, value: NonNullable<ProviderDirectBinding["coinbaseGasless"]>): void {
  if (!isPlainRecord(value) || !exactKeys(value, ["schemaVersion", "chainId", "token", "grossAtomic", "netAtomic", "feeAtomic",
    "maxFeeAtomic", "minReceivedAtomic", "senderNativeDebitWei", "sponsorship", "exclusiveAccountUseRequired", "awalPackage",
    "awalVersion", "awalCommand", "rpcOrigin", "safeBlock", "entryPoint", "entryPointCodeHash", "accountCodeHash",
    "accountImplementation", "accountImplementationCodeHash"]) || value.schemaVersion !== "apn.coinbase-gasless.v1" ||
    value.chainId !== CHAIN_ID || value.token !== BASE_USDC || value.grossAtomic !== operation.amountAtomic ||
    value.netAtomic !== operation.amountAtomic || value.feeAtomic !== "0" || value.senderNativeDebitWei !== "0" ||
    value.sponsorship !== "coinbase_cdp_paymaster" || value.exclusiveAccountUseRequired !== true ||
    value.awalPackage !== "awal" || value.awalVersion !== "2.12.1" || value.awalCommand !== "send_base_usdc" ||
    typeof value.rpcOrigin !== "string" || value.rpcOrigin.length === 0 || value.entryPoint !== "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789" ||
    value.entryPointCodeHash !== "0xc93c806e738300b5357ecdc2e971d6438d34d8e4e17b99b758b1f9cac91c8e70" ||
    value.accountCodeHash !== "0xaaa52c8cc8a0e3fd27ce756cc6b4e70c51423e9b597b11f32d3e49f8b1fc890d" ||
    value.accountImplementation !== "0x00000110dCdEdC9581cb5eCB8467282f2926534d" ||
    value.accountImplementationCodeHash !== "0x136185896fc519277ec953c0b3d048fc0c9f607b8d04022e60f23ef8dbc6c4d5") {
    stateCorrupt("Coinbase gasless immutable binding is invalid.");
  }
  const gross = parseAtomic(value.grossAtomic, { positive: true }), minimum = parseAtomic(value.minReceivedAtomic, { positive: true });
  parseAtomic(value.maxFeeAtomic); if (minimum > gross) stateCorrupt("Coinbase gasless amount bounds are invalid.");
  validateCoinbaseBlock(value.safeBlock);
  if (operation.providerEffect !== undefined || operation.state === "abandoned_unknown" ||
    operation.transitions.some(row => row.state === "abandoned_unknown") || operation.coinbaseGaslessCursor === undefined) {
    stateCorrupt("Coinbase gasless journal posture is invalid.");
  }
  const cursor = operation.coinbaseGaslessCursor;
  parseAtomic(cursor.nextBlockAtomic);
  const anchor = BigInt(value.safeBlock.numberAtomic), next = BigInt(cursor.nextBlockAtomic);
  if (cursor.previousEndBlock === null) {
    if (next !== anchor + 1n) stateCorrupt("Coinbase gasless initial cursor does not follow its safe anchor.");
  } else {
    validateCoinbaseBlock(cursor.previousEndBlock);
    const previousEnd = BigInt(cursor.previousEndBlock.numberAtomic);
    if (previousEnd < anchor + 1n || next !== previousEnd + 1n) stateCorrupt("Coinbase gasless cursor is discontinuous.");
  }
  if (operation.coinbaseGaslessLocator !== undefined) {
    const locator = operation.coinbaseGaslessLocator;
    if (!isPlainRecord(locator) || !exactKeys(locator, ["schemaVersion", "hash", "provenance"]) ||
      locator.schemaVersion !== "apn.coinbase-gasless-locator.v1" || !/^0x[0-9a-f]{64}$/u.test(locator.hash) ||
      !["awal_success_transaction_hash_field", "awal_error_text_hint"].includes(locator.provenance)) stateCorrupt("Coinbase gasless locator is invalid.");
  }
  if (operation.coinbaseGaslessSettlement !== undefined) {
    const settlement = operation.coinbaseGaslessSettlement;
    if (!isPlainRecord(settlement) || !exactKeys(settlement, ["schemaVersion", "userOperationHash", "transactionHash", "nonceAtomic",
      "paymaster", "paymasterCodeHash", "block", "safeBlock", "evidenceHash", "grossAtomic", "netAtomic", "feeAtomic",
      "senderNativeDebitWei"]) || settlement.schemaVersion !== "apn.coinbase-gasless-settlement.v1" ||
      !/^0x[0-9a-f]{64}$/u.test(settlement.userOperationHash) || !/^0x[0-9a-f]{64}$/u.test(settlement.transactionHash) ||
      !/^0x[0-9a-fA-F]{40}$/u.test(settlement.paymaster) || settlement.paymaster.toLowerCase() === "0x0000000000000000000000000000000000000000" ||
      !/^0x[0-9a-f]{64}$/u.test(settlement.paymasterCodeHash) || !/^[a-f0-9]{64}$/u.test(settlement.evidenceHash) ||
      settlement.grossAtomic !== operation.amountAtomic || settlement.netAtomic !== operation.amountAtomic ||
      settlement.feeAtomic !== "0" || settlement.senderNativeDebitWei !== "0" || operation.transactionHash !== settlement.transactionHash ||
      operation.state !== "completed" || !operation.terminal) stateCorrupt("Coinbase gasless settlement is invalid.");
    parseAtomic(settlement.nonceAtomic); validateCoinbaseBlock(settlement.block); validateCoinbaseBlock(settlement.safeBlock);
    if (BigInt(settlement.block.numberAtomic) <= BigInt(value.safeBlock.numberAtomic) ||
      BigInt(settlement.safeBlock.numberAtomic) < BigInt(settlement.block.numberAtomic)) {
      stateCorrupt("Coinbase gasless settlement falls outside its frozen safe observation range.");
    }
    const { evidenceHash, ...evidenceBody } = settlement;
    if (evidenceHash !== hashObject(evidenceBody)) stateCorrupt("Coinbase gasless settlement evidence hash is invalid.");
  } else if (operation.state === "completed") stateCorrupt("Coinbase gasless completion lacks settlement evidence.");
}

function validateCoinbaseBlock(value: import("./model.js").CoinbaseGaslessBlock): void {
  if (!isPlainRecord(value) || !exactKeys(value, ["numberAtomic", "hash", "timestampAtomic"]) ||
    !/^0x[0-9a-f]{64}$/u.test(value.hash)) stateCorrupt("Coinbase gasless block is invalid.");
  parseAtomic(value.numberAtomic); parseAtomic(value.timestampAtomic);
}

function validDelegatedBinding(binding: ProviderDirectBinding): boolean {
  if (binding.executionMode !== "delegated_session_transaction") return false;
  return Number.isSafeInteger(binding.permissionRevision) && binding.permissionRevision > 0 &&
    /^[a-f0-9]{64}$/u.test(binding.rootGrantFingerprint) &&
    /^0x[0-9a-fA-F]{40}$/u.test(binding.sessionAddress) &&
    /^0x[0-9a-fA-F]{40}$/u.test(binding.delegationManager) &&
    Number.isSafeInteger(binding.permissionExpiresAtUnix) && binding.permissionExpiresAtUnix > 0;
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
