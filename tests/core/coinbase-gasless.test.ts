import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, parseAbiParameters } from "viem";
import { COINBASE_ACCOUNT_CODE_HASH, COINBASE_ACCOUNT_IMPLEMENTATION, COINBASE_ACCOUNT_IMPLEMENTATION_CODE_HASH,
  COINBASE_ENTRY_POINT, COINBASE_ENTRY_POINT_CODE_HASH, coinbaseGaslessSnapshot, observeCoinbaseGasless } from "../../src/coinbase-gasless-observer.js";
import { BASE_USDC, TRANSFER_TOPIC } from "../../src/constants.js";
import type { Address, Hex, OperationRecord } from "../../src/model.js";
import type { RpcPort } from "../../src/ports.js";
import { appendTransition, sealOperation, validateOperation } from "../../src/state-integrity.js";
import { providerDirectReceipt, recoverProviderTerminalOperation } from "../../src/provider-direct-receipt.js";
import { validateEvmOperationWrite } from "../../src/evm-operation-write.js";
import { ApnCore } from "../../src/core.js";
import { AwalProcessAdapter, AWAL_PROVIDER_ID, type AwalProcessRunnerPort } from "../../src/awal-process-adapter.js";
import type { DirectExecutionPort, ForegroundAuthenticationPort } from "../../src/provider-ports.js";
import { ProviderRegistry } from "../../src/provider-registry.js";
import { StateProfileRepository } from "../../src/profile-repository.js";
import { StateStore } from "../../src/state.js";
import { runCli } from "../../src/cli.js";
import { temporaryState } from "./helpers.js";
import { sha256 } from "../../src/canonical.js";
import { OperationService } from "../../src/operation-service.js";

const SENDER = "0x1111111111111111111111111111111111111111" as Address;
const RECIPIENT = "0x2222222222222222222222222222222222222222" as Address;
const IMPLEMENTATION = COINBASE_ACCOUNT_IMPLEMENTATION;
const PAYMASTER = "0x4444444444444444444444444444444444444444" as Address;
const OUTER = "0x5555555555555555555555555555555555555555" as Address;
const TX = `0x${"a".repeat(64)}` as Hex;
const USER_OPERATION_EVENT = "0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f" as Hex;
const BLOCK_80 = { numberAtomic: "80", hash: `0x${"8".repeat(64)}` as Hex, timestampAtomic: "800" };
const BLOCK_90 = { numberAtomic: "90", hash: `0x${"9".repeat(64)}` as Hex, timestampAtomic: "900" };
const BLOCK_100 = { numberAtomic: "100", hash: `0x${"b".repeat(64)}` as Hex, timestampAtomic: "1000" };
const BLOCK_110 = { numberAtomic: "110", hash: `0x${"c".repeat(64)}` as Hex, timestampAtomic: "1100" };
const deployment = JSON.parse(readFileSync("tests/core/fixtures/coinbase-base-deployment.json", "utf8")) as {
  readonly accountCode: Hex; readonly implementationCode: Hex; readonly entryPointCode: Hex;
};
const ACCOUNT_CODE = deployment.accountCode, IMPLEMENTATION_CODE = deployment.implementationCode;
const ENTRY_POINT_CODE = deployment.entryPointCode, PAYMASTER_CODE = "0x60046000" as Hex;
const ENTRY_POINT_ABI = parseAbi(["function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,uint256 callGasLimit,uint256 verificationGasLimit,uint256 preVerificationGas,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,bytes paymasterAndData,bytes signature)[] ops,address beneficiary)"]);
const ACCOUNT_ABI = parseAbi(["function executeBatch((address target,uint256 value,bytes data)[] calls)"]);
const TOKEN_ABI = parseAbi(["function transfer(address to,uint256 value) returns (bool)"]);

class CoinbaseRpcFixture implements RpcPort {
  safeBlock = BLOCK_110;
  locatorMode: "transaction" | "userop" | "hashless" = "transaction";
  extraCandidate = false;
  wrongRecipient = false;
  noCandidate = false;
  extraTokenDebit = false;
  unsupportedAccount = false;
  implementationCodeDriftAtInclusion = false;
  transactionBlock = BLOCK_100;
  block110 = BLOCK_110;
  readonly rpcOrigin = "https://rpc.example";
  readonly callLog: Array<{ method: string; params: readonly unknown[] }> = [];
  readonly userOp = { sender: SENDER, nonce: 7n, initCode: "0x" as Hex,
    callData: encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "executeBatch", args: [[{ target: BASE_USDC, value: 0n,
      data: encodeFunctionData({ abi: TOKEN_ABI, functionName: "transfer", args: [RECIPIENT, 1000n] }) }]] }),
    callGasLimit: 100000n, verificationGasLimit: 200000n, preVerificationGas: 50000n,
    maxFeePerGas: 10n, maxPriorityFeePerGas: 1n, paymasterAndData: `${PAYMASTER}1234` as Hex, signature: "0x1234" as Hex };
  readonly userOperationHash = v06Hash(this.userOp);
  get transaction() { return { hash: TX, from: OUTER, to: COINBASE_ENTRY_POINT, value: "0x0", blockHash: this.transactionBlock.hash,
    blockNumber: `0x${BigInt(this.transactionBlock.numberAtomic).toString(16)}`, transactionIndex: "0x0",
    input: encodeFunctionData({ abi: ENTRY_POINT_ABI, functionName: "handleOps", args: [[this.userOp], OUTER] }) }; }
  get logs() {
    const common = { transactionHash: TX, blockHash: this.transactionBlock.hash,
      blockNumber: `0x${BigInt(this.transactionBlock.numberAtomic).toString(16)}`, transactionIndex: "0x0", removed: false };
    return [
      { ...common, address: BASE_USDC, topics: [TRANSFER_TOPIC, word(SENDER), word(this.wrongRecipient ? OUTER : RECIPIENT)],
        data: wordUint(1000n), logIndex: "0x0" },
      { ...common, address: COINBASE_ENTRY_POINT, topics: [USER_OPERATION_EVENT, this.userOperationHash, word(SENDER), word(PAYMASTER)],
        data: encodeAbiParameters(parseAbiParameters("uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed"), [7n, true, 100n, 90n]), logIndex: "0x1" },
      ...(this.extraTokenDebit ? [{ ...common, address: OUTER, topics: [TRANSFER_TOPIC, word(SENDER), word(PAYMASTER)],
        data: wordUint(1n), logIndex: "0x2" }] : []),
    ];
  }
  async assertBaseChain() { return { chainId: 8453 as const, rpcOrigin: this.rpcOrigin }; }
  async coinbaseGaslessCall(method: Parameters<NonNullable<RpcPort["coinbaseGaslessCall"]>>[0], params: readonly unknown[]) {
    this.callLog.push({ method, params }); const arg = params[0];
    if (method === "eth_getBlockByNumber") {
      if (arg === "safe") return blockRaw(this.safeBlock, []);
      const number = BigInt(arg as string);
      if (number === 90n) return blockRaw(BLOCK_90, []);
      if (number === BigInt(this.transactionBlock.numberAtomic)) return blockRaw(this.transactionBlock, [TX]);
      if (number === 110n) return blockRaw(this.block110, []);
      return blockRaw({ numberAtomic: number.toString(), hash: `0x${number.toString(16).padStart(64, "0")}` as Hex, timestampAtomic: number.toString() }, []);
    }
    if (method === "eth_getTransactionByHash") return arg === TX ? this.transaction : null;
    if (method === "eth_getTransactionReceipt") return arg === TX ? { transactionHash: TX, status: "0x1",
      blockNumber: `0x${BigInt(this.transactionBlock.numberAtomic).toString(16)}`,
      blockHash: this.transactionBlock.hash, transactionIndex: "0x0", logs: this.logs } : null;
    if (method === "eth_getCode") {
      if (arg === COINBASE_ENTRY_POINT) return ENTRY_POINT_CODE;
      if (arg === SENDER) return this.unsupportedAccount ? "0x60016000" : ACCOUNT_CODE;
      if (arg === IMPLEMENTATION) return this.implementationCodeDriftAtInclusion && params[1] === "0x64" ? "0x60056000" : IMPLEMENTATION_CODE;
      if (arg === PAYMASTER) return PAYMASTER_CODE;
      return "0x";
    }
    if (method === "eth_getStorageAt") return `0x${IMPLEMENTATION.slice(2).padStart(64, "0")}`;
    if (method === "eth_call") {
      const input = params[0] as { readonly to: Address; readonly data: Hex };
      if (input.to === BASE_USDC) return wordUint(1000000n);
      if (input.data === "0xb0d691fe") return word(COINBASE_ENTRY_POINT);
      if (input.data === "0x5c60da1b") return word(IMPLEMENTATION);
      throw new Error("unexpected eth_call");
    }
    if (method === "eth_getBalance") return "0x0";
    throw new Error(`unexpected ${method}`);
  }
  async coinbaseGaslessLogs(filter: Readonly<Record<string, unknown>>): Promise<readonly unknown[]> {
    const topics = filter.topics as readonly Hex[];
    if (topics[0] === USER_OPERATION_EVENT) return this.locatorMode === "userop" && topics[1] === this.userOperationHash ? [this.logs[1]!] : [];
    if (topics[0] === TRANSFER_TOPIC) return this.noCandidate ? [] : [this.logs[0]!, ...(this.extraCandidate ? [{ ...this.logs[0]!, transactionHash: `0x${"d".repeat(64)}`, logIndex: "0x3" }] : [])];
    return [];
  }
  async getBalances(): Promise<never> { throw new Error(); } async getX402PrepareEvidence(): Promise<never> { throw new Error(); }
  async getPendingNonce(): Promise<never> { throw new Error(); } async estimateDirectTransfer(): Promise<never> { throw new Error(); }
  async estimateTransaction(): Promise<never> { throw new Error(); } async submitRawTransaction(): Promise<never> { throw new Error(); }
  async getReceipt(): Promise<null> { return null; } async getLatestConfirmedNonce(): Promise<never> { throw new Error(); }
  async getConfirmedTransactionAtNonce(): Promise<null> { return null; }
}

test("Coinbase gasless snapshot freezes safe account, implementation, EntryPoint and balance identity", async () => {
  const rpc = new CoinbaseRpcFixture(); const snapshot = await coinbaseGaslessSnapshot(rpc, SENDER);
  assert.deepEqual(snapshot, { rpcOrigin: rpc.rpcOrigin, safeBlock: BLOCK_110, balanceAtomic: "1000000",
    entryPointCodeHash: COINBASE_ENTRY_POINT_CODE_HASH, accountCodeHash: COINBASE_ACCOUNT_CODE_HASH,
    accountImplementation: IMPLEMENTATION, accountImplementationCodeHash: keccak256(IMPLEMENTATION_CODE) });
});

test("Coinbase gasless snapshot rejects an account outside the accepted public decoder deployment", async () => {
  const rpc = new CoinbaseRpcFixture(); rpc.unsupportedAccount = true;
  await assert.rejects(() => coinbaseGaslessSnapshot(rpc, SENDER), { code: "APN_RPC_PROTOCOL" });
});

test("Coinbase gasless observation classifies transaction, UserOp and hashless paths only by canonical positive proof", async () => {
  for (const mode of ["transaction", "userop", "hashless"] as const) {
    const rpc = new CoinbaseRpcFixture(); rpc.locatorMode = mode;
    const operation = makeOperation(rpc, mode === "hashless" ? undefined : { schemaVersion: "apn.coinbase-gasless-locator.v1",
      hash: mode === "transaction" ? TX : rpc.userOperationHash, provenance: "awal_success_transaction_hash_field" });
    const observed = await observeCoinbaseGasless(rpc, operation);
    assert.equal(observed.status, "safe", mode);
    if (observed.status === "safe") {
      assert.equal(observed.settlement.transactionHash, TX); assert.equal(observed.settlement.userOperationHash, rpc.userOperationHash);
      assert.equal(observed.settlement.paymaster, PAYMASTER); assert.equal(observed.settlement.grossAtomic, "1000");
      assert.equal(observed.settlement.netAtomic, "1000"); assert.equal(observed.settlement.feeAtomic, "0");
      assert.equal(observed.settlement.senderNativeDebitWei, "0");
    }
  }
});

test("Coinbase gasless observation retains ambiguity for multiple candidates and accounting mismatch", async () => {
  const multiple = new CoinbaseRpcFixture(); multiple.locatorMode = "hashless"; multiple.extraCandidate = true;
  assert.equal((await observeCoinbaseGasless(multiple, makeOperation(multiple))).status, "ambiguous");
  const mismatch = new CoinbaseRpcFixture(); mismatch.locatorMode = "hashless"; mismatch.wrongRecipient = true;
  assert.notEqual((await observeCoinbaseGasless(mismatch, makeOperation(mismatch))).status, "safe");
  const hintedMismatch = new CoinbaseRpcFixture(); hintedMismatch.wrongRecipient = true; hintedMismatch.noCandidate = true;
  assert.equal((await observeCoinbaseGasless(hintedMismatch, makeOperation(hintedMismatch, {
    schemaVersion: "apn.coinbase-gasless-locator.v1", hash: TX, provenance: "awal_error_text_hint",
  }))).status, "ambiguous", "error-text transaction locator is only a hint and cannot replace exact accounting proof");
  const tokenFee = new CoinbaseRpcFixture(); tokenFee.extraTokenDebit = true;
  assert.equal((await observeCoinbaseGasless(tokenFee, makeOperation(tokenFee))).status, "ambiguous",
    "a second sender ERC-20 debit cannot be classified as zero user token fee");
});

test("secondary account calls, native value and frozen deployment tamper stay guarded", async () => {
  for (const secondCall of [
    { target: BASE_USDC, value: 0n, data: "0x095ea7b3" as Hex },
    { target: RECIPIENT, value: 1n, data: "0x" as Hex },
  ]) {
    const rpc = new CoinbaseRpcFixture();
    const desired = { target: BASE_USDC, value: 0n, data: encodeFunctionData({ abi: TOKEN_ABI,
      functionName: "transfer", args: [RECIPIENT, 1000n] }) };
    (rpc.userOp as { callData: Hex }).callData = encodeFunctionData({ abi: ACCOUNT_ABI,
      functionName: "executeBatch", args: [[desired, secondCall]] });
    (rpc as { userOperationHash: Hex }).userOperationHash = v06Hash(rpc.userOp);
    (rpc.transaction as { input: Hex }).input = encodeFunctionData({ abi: ENTRY_POINT_ABI,
      functionName: "handleOps", args: [[rpc.userOp], OUTER] });
    assert.equal((await observeCoinbaseGasless(rpc, makeOperation(rpc, {
      schemaVersion: "apn.coinbase-gasless-locator.v1", hash: TX, provenance: "awal_success_transaction_hash_field",
    }))).status, "ambiguous");
  }
  const rpc = new CoinbaseRpcFixture(), previous = makeOperation(rpc);
  const changedBinding = { ...previous.providerDirect!, coinbaseGasless: { ...previous.providerDirect!.coinbaseGasless!,
    safeBlock: { ...BLOCK_90, hash: `0x${"8".repeat(64)}` as Hex } } } as NonNullable<OperationRecord["providerDirect"]>;
  const { integrityHash: _old, ...base } = previous;
  const rewritten = sealOperation({ ...base, providerDirect: changedBinding });
  assert.throws(() => validateEvmOperationWrite(rewritten, previous),
    (error: unknown) => (error as { code?: string }).code === "APN_STATE_CORRUPT");
});

test("pre-anchor candidates and inclusion-time implementation drift stay guarded", async () => {
  const historical = new CoinbaseRpcFixture();
  historical.transactionBlock = BLOCK_80;
  historical.noCandidate = true;
  assert.equal((await observeCoinbaseGasless(historical, makeOperation(historical, {
    schemaVersion: "apn.coinbase-gasless-locator.v1", hash: TX, provenance: "awal_error_text_hint",
  }))).status, "ambiguous", "a transaction or error-text hash before the frozen anchor cannot prove this dispatch");
  const sameBlock = new CoinbaseRpcFixture(); sameBlock.transactionBlock = BLOCK_90; sameBlock.noCandidate = true;
  assert.equal((await observeCoinbaseGasless(sameBlock, makeOperation(sameBlock, {
    schemaVersion: "apn.coinbase-gasless-locator.v1", hash: TX, provenance: "awal_success_transaction_hash_field",
  }))).status, "ambiguous", "a matching transfer in the safe-anchor block necessarily predates the dispatch");

  const drifted = new CoinbaseRpcFixture();
  drifted.implementationCodeDriftAtInclusion = true;
  assert.equal((await observeCoinbaseGasless(drifted, makeOperation(drifted, {
    schemaVersion: "apn.coinbase-gasless-locator.v1", hash: TX, provenance: "awal_success_transaction_hash_field",
  }))).status, "ambiguous", "the account implementation code must match its saved pin at the canonical event block");
});

test("bounded absence advances only the durable scan cursor and never becomes terminal negative proof", async () => {
  const rpc = new CoinbaseRpcFixture(); rpc.locatorMode = "hashless"; rpc.noCandidate = true;
  const operation = makeOperation(rpc);
  const first = await observeCoinbaseGasless(rpc, operation);
  assert.equal(first.status, "not_found");
  if (first.status === "not_found") {
    assert.deepEqual(first.cursor, { nextBlockAtomic: "111", previousEndBlock: BLOCK_110 });
    const next = sealOperation({ ...operation, coinbaseGaslessCursor: first.cursor });
    const second = await observeCoinbaseGasless(rpc, next);
    assert.equal(second.status, "pending");
  }
});

test("a changed prior cursor boundary is unresolved and never skips the replaced range", async () => {
  const rpc = new CoinbaseRpcFixture(); rpc.locatorMode = "hashless"; rpc.noCandidate = true;
  const operation = makeOperation(rpc);
  const first = await observeCoinbaseGasless(rpc, operation);
  assert.equal(first.status, "not_found");
  if (first.status !== "not_found") return;
  const next = sealOperation({ ...operation, coinbaseGaslessCursor: first.cursor });
  rpc.block110 = { ...BLOCK_110, hash: `0x${"7".repeat(64)}` as Hex };
  const reorged = await observeCoinbaseGasless(rpc, next);
  assert.equal(reorged.status, "unresolved");
  assert.deepEqual(reorged.cursor, first.cursor);
});

test("an unresolved Coinbase account blocks a gasless alias bound to the same provider account", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const rpc = new CoinbaseRpcFixture(), state = new StateStore(temporary.root), ambiguous = makeOperation(rpc);
  const { integrityHash: _integrity, coinbaseGaslessLocator: _locator, coinbaseGaslessSettlement: _settlement,
    transactionHash: _transaction, ...base } = ambiguous;
  const transition = ambiguous.transitions[0]!;
  const operation = sealOperation({ ...base, state: transition.state, terminal: false, reason: transition.reason,
    proofClass: transition.proofClass, transitions: [transition] });
  await state.initialize();
  await state.writeOperation(operation);
  const service = new OperationService(state);
  await assert.rejects(() => service.assertProviderAccountAvailable("coinbase-agentic-wallet",
    operation.providerDirect!.accountBindingHash, operation.walletAddress), { code: "APN_OPERATION_BLOCKED" });
  await service.assertProviderAccountAvailable("coinbase-agentic-wallet", "6".repeat(64), OUTER);
});

test("a Coinbase canonical terminal receipt recovers an operation-write crash and settlement tampering fails integrity", async () => {
  const rpc = new CoinbaseRpcFixture(); rpc.locatorMode = "hashless";
  const previous = makeOperation(rpc);
  const observed = await observeCoinbaseGasless(rpc, previous);
  assert.equal(observed.status, "safe");
  if (observed.status !== "safe") return;
  const { integrityHash: _old, ...base } = previous;
  const completed = sealOperation({ ...base, transactionHash: observed.settlement.transactionHash,
    coinbaseGaslessSettlement: observed.settlement, coinbaseGaslessCursor: observed.cursor,
    state: "completed", terminal: true, reason: "confirmed_coinbase_gasless_transfer",
    proofClass: "canonical_safe_coinbase_gasless_settlement", transitions: appendTransition(previous.transitions, {
      at: "2026-09-12T00:00:01.000Z", state: "completed", terminal: true,
      reason: "confirmed_coinbase_gasless_transfer", proofClass: "canonical_safe_coinbase_gasless_settlement",
    }) });
  const receipt = providerDirectReceipt(completed);
  assert.deepEqual(recoverProviderTerminalOperation(previous, receipt), completed);
  const badSettlement = { ...completed.coinbaseGaslessSettlement!, feeAtomic: "1" as "0" };
  const tampered = sealOperation({ ...completed, coinbaseGaslessSettlement: badSettlement });
  assert.throws(() => validateOperation(tampered), (error: unknown) => (error as { code?: string }).code === "APN_STATE_CORRUPT");
});

test("common gasless prepare/approve/status/resume/receipt uses the provider-direct one-dispatch journal", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const rpc = new CoinbaseRpcFixture(); rpc.safeBlock = BLOCK_90;
  const runner: AwalProcessRunnerPort = { run: async (argv) => argv[0] === "balance"
    ? { exitCode: 0, stdout: Buffer.from(JSON.stringify({ address: SENDER, chain: "Base",
      balances: { USDC: { raw: "1000000", formatted: "1 USDC", decimals: 6 } }, timestamp: "2026-09-12T00:00:00.000Z" })) }
    : argv[0] === "address" ? { exitCode: 0, stdout: Buffer.from(SENDER) } : { exitCode: 0, stdout: Buffer.alloc(0) } };
  let sends = 0, preparedOperationId = "";
  const direct: DirectExecutionPort = { mode: "provider_atomic_send", assertCompatibleIntent: () => {},
    execute: async () => {
      const started = await new StateStore(temporary.root).loadOperation(sha256("profile\0coinbase-gasless"), preparedOperationId);
      assert.equal(started?.state, "started", "durable started marker must precede the only AWAL child invocation");
      sends += 1; return { disposition: "acknowledged", transactionHash: TX };
    } };
  const registry = new ProviderRegistry([{ provider_id: AWAL_PROVIDER_ID,
    create: () => new AwalProcessAdapter(runner, direct).bundle() }]);
  const foreground: ForegroundAuthenticationPort = { readIdentity: async () => "safe@example.invalid",
    readChallengeResponse: async () => "123456", confirmRebind: async () => true };
  const connected = await runCli(["wallet", "connect", "--profile", "coinbase-gasless", "--provider", AWAL_PROVIDER_ID], {},
    { stateRoot: temporary.root, providerRegistry: registry, foregroundAuthentication: foreground });
  assert.equal(connected.ok, true, JSON.stringify(connected));
  const state = new StateStore(temporary.root), approvalCalls: unknown[] = [];
  const core = new ApnCore({ state, profileRepository: new StateProfileRepository(state), providerRegistry: registry,
    rpc, rpcUrl: "https://rpc.example/", clock: { now: () => new Date("2026-09-12T00:00:00.000Z") },
    gasless: { rpcFor: () => { throw new Error("local gasless must not run"); }, custody: {} as never,
      approval: { confirm: async (input) => { approvalCalls.push(input); return true; } } } });
  const request = { command: "gasless.transfer.prepare" as const, profile: "coinbase-gasless",
    request: { chainId: 8453 as const, recipient: RECIPIENT, grossAtomic: "1000", maxFeeAtomic: "0", minReceivedAtomic: "1000" },
    idempotencyKey: "coinbase-gasless-001" };
  const prepared = await core.execute(request);
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  rpc.safeBlock = BLOCK_110;
  const preparedRow = prepared.operation as any;
  preparedOperationId = preparedRow.operation_id;
  assert.equal(preparedRow.gasless_provider, AWAL_PROVIDER_ID); assert.equal(preparedRow.transfer.gross_atomic, "1000");
  assert.equal(preparedRow.transfer.recipient_atomic, "1000"); assert.equal(preparedRow.transfer.quoted_fee_budget_atomic, "0");
  assert.equal(preparedRow.dispatch.maximum_invocations, 1); assert.equal(preparedRow.dispatch.retry_after_started, false);
  const approved = await core.execute({ command: "gasless.transfer.approve", operationId: preparedRow.operation_id });
  assert.equal(approved.ok, true, JSON.stringify(approved)); assert.equal((approved.operation as any).state, "completed");
  assert.equal(sends, 1); assert.equal(approvalCalls.length, 1);
  const status = await core.execute({ command: "operation.status", operationId: preparedRow.operation_id });
  const resumed = await core.execute({ command: "operation.resume", operationId: preparedRow.operation_id });
  const receipt = await core.execute({ command: "receipt.get", operationId: preparedRow.operation_id });
  assert.equal((status.operation as any).state, "completed"); assert.equal((resumed.operation as any).state, "completed");
  assert.equal((receipt.receipt as any).coinbase_gasless_settlement.feeAtomic, "0"); assert.equal(sends, 1);
  const callsBeforeReplay = rpc.callLog.length; rpc.unsupportedAccount = true;
  const replay = await core.execute(request); assert.equal((replay.operation as any).operation_id, preparedRow.operation_id); assert.equal(sends, 1);
  assert.equal(rpc.callLog.length, callsBeforeReplay, "saved same-key prepare returns without a live RPC snapshot");
  const conflict = await core.execute({ command: "transfer.prepare", profile: "coinbase-gasless",
    idempotencyKey: "coinbase-gasless-001", recipient: RECIPIENT, amount: "0.001" });
  assert.equal(conflict.error?.code, "APN_IDEMPOTENCY_CONFLICT");
});

function makeOperation(rpc: CoinbaseRpcFixture, locator?: OperationRecord["coinbaseGaslessLocator"]): OperationRecord {
  const binding = { schemaVersion: "apn.provider-direct.v1" as const, providerId: "coinbase-agentic-wallet", profileRevision: 1,
    capabilityHash: "1".repeat(64), accountBindingHash: "2".repeat(64), rpcBindingHash: "3".repeat(64), rpcOriginHash: "4".repeat(64),
    policy: { identity: "apn.direct.foreground-approval.v1" as const, verdict: "foreground_approval_required" as const, foregroundApprovalRequired: true as const },
    executionMode: "provider_atomic_send" as const, executionOwner: "provider" as const, retryOwner: "apn_outer_no_replay_journal" as const,
    coinbaseGasless: { schemaVersion: "apn.coinbase-gasless.v1" as const, chainId: 8453 as const, token: BASE_USDC,
      grossAtomic: "1000", netAtomic: "1000", feeAtomic: "0" as const, maxFeeAtomic: "0", minReceivedAtomic: "1000",
      senderNativeDebitWei: "0" as const, sponsorship: "coinbase_cdp_paymaster" as const, exclusiveAccountUseRequired: true as const,
      awalPackage: "awal" as const, awalVersion: "2.12.1" as const, awalCommand: "send_base_usdc" as const,
      rpcOrigin: rpc.rpcOrigin, safeBlock: BLOCK_90, entryPoint: COINBASE_ENTRY_POINT, entryPointCodeHash: COINBASE_ENTRY_POINT_CODE_HASH,
      accountCodeHash: COINBASE_ACCOUNT_CODE_HASH, accountImplementation: IMPLEMENTATION,
      accountImplementationCodeHash: COINBASE_ACCOUNT_IMPLEMENTATION_CODE_HASH } };
  let transitions = appendTransition([], { at: "2026-09-12T00:00:00.000Z", state: "awaiting_approval", terminal: false,
    reason: "prepared_coinbase_gasless_provider_atomic_send", proofClass: "durable_coinbase_gasless_intent" });
  transitions = appendTransition(transitions, { at: "2026-09-12T00:00:00.100Z", state: "started", terminal: false,
    reason: "provider_effect_started", proofClass: "durable_provider_no_replay" });
  transitions = appendTransition(transitions, { at: "2026-09-12T00:00:00.200Z", state: "ambiguous_effect", terminal: false,
    reason: "coinbase_gasless_observation_required", proofClass: "provider_effect_no_replay" });
  return sealOperation({ schemaVersion: "apn.state.v1", operationId: "a".repeat(64), idempotencyHash: "b".repeat(64), profile: "coinbase",
    profileHash: "c".repeat(64), requestHash: "d".repeat(64), fingerprint: "e".repeat(64), walletAddress: SENDER,
    recipient: RECIPIENT, amountAtomic: "1000", amountDecimal: "0.001", chainId: 8453, token: BASE_USDC, providerDirect: binding,
    ...(locator === undefined ? {} : { coinbaseGaslessLocator: locator }), coinbaseGaslessCursor: { nextBlockAtomic: "91", previousEndBlock: null },
    preparedAt: "2026-09-12T00:00:00.000Z", expiresAt: "2026-09-12T00:01:00.000Z", state: "ambiguous_effect", terminal: false,
    reason: "coinbase_gasless_observation_required", proofClass: "provider_effect_no_replay", transitions });
}

function v06Hash(op: CoinbaseRpcFixture["userOp"]): Hex {
  const packed = encodeAbiParameters(parseAbiParameters("address sender,uint256 nonce,bytes32 initCodeHash,bytes32 callDataHash,uint256 callGasLimit,uint256 verificationGasLimit,uint256 preVerificationGas,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,bytes32 paymasterAndDataHash"),
    [op.sender, op.nonce, keccak256(op.initCode), keccak256(op.callData), op.callGasLimit, op.verificationGasLimit,
      op.preVerificationGas, op.maxFeePerGas, op.maxPriorityFeePerGas, keccak256(op.paymasterAndData)]);
  return keccak256(encodeAbiParameters(parseAbiParameters("bytes32 userOpHash,address entryPoint,uint256 chainId"), [keccak256(packed), COINBASE_ENTRY_POINT, 8453n]));
}
function word(value: Address): Hex { return `0x${value.slice(2).toLowerCase().padStart(64, "0")}`; }
function wordUint(value: bigint): Hex { return `0x${value.toString(16).padStart(64, "0")}`; }
function blockRaw(value: typeof BLOCK_90, transactions: readonly Hex[]) { return { number: `0x${BigInt(value.numberAtomic).toString(16)}`,
  hash: value.hash, timestamp: `0x${BigInt(value.timestampAtomic).toString(16)}`, transactions }; }
