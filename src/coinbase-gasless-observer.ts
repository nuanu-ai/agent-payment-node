import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, encodeFunctionData, getAddress, keccak256,
  parseAbi, parseAbiParameters } from "viem";
import { COINBASE_OBSERVATION_ORIGIN } from "./coinbase-gasless-observation-source.js";
import { hashObject } from "./canonical.js";
import { BASE_USDC, CHAIN_ID, TRANSFER_TOPIC } from "./constants.js";
import { ApnError } from "./errors.js";
import type { Address, CoinbaseGaslessBinding, CoinbaseGaslessBlock, CoinbaseGaslessCursor,
  CoinbaseGaslessLocator, CoinbaseGaslessSettlement, Hex, OperationRecord } from "./model.js";
import type { RpcPort } from "./ports.js";

export const COINBASE_ENTRY_POINT = getAddress("0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789") as Address;
export const COINBASE_ACCOUNT_IMPLEMENTATION = getAddress("0x00000110DcdEDc9581cb5ECb8467282f2926534D") as Address;
export const COINBASE_ACCOUNT_CODE_HASH =
  "0xaaa52c8cc8a0e3fd27ce756cc6b4e70c51423e9b597b11f32d3e49f8b1fc890d" as Hex;
export const COINBASE_ACCOUNT_IMPLEMENTATION_CODE_HASH =
  "0x136185896fc519277ec953c0b3d048fc0c9f607b8d04022e60f23ef8dbc6c4d5" as Hex;
export const COINBASE_ENTRY_POINT_CODE_HASH =
  "0xc93c806e738300b5357ecdc2e971d6438d34d8e4e17b99b758b1f9cac91c8e70" as Hex;
const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as Hex;
const USER_OPERATION_EVENT =
  "0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f" as Hex;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
/**
 * One resume scans from the cursor to the current safe head in eth_getLogs windows of up to 2,000 blocks. A range
 * refusal (or an over-bound answer) halves the window; any other refusal stops the pass with the progress kept. The
 * query budget is the read plan: one Transfer query per window plus one UserOperation query when a locator exists,
 * and halvings spend from the same budget (24 queries = at least 12 windows, about 13 hours of Base, per resume).
 */
const LOG_WINDOW = 2_000n;
const MAX_LOG_QUERIES_PER_PASS = 24;
const ENTRY_POINT_SELECTOR = "0xb0d691fe" as Hex;
const IMPLEMENTATION_SELECTOR = "0x5c60da1b" as Hex;

const ENTRY_POINT_ABI = parseAbi([
  "function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,uint256 callGasLimit,uint256 verificationGasLimit,uint256 preVerificationGas,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,bytes paymasterAndData,bytes signature)[] ops,address beneficiary)",
]);
const ACCOUNT_ABI = parseAbi([
  "function execute(address target,uint256 value,bytes data)",
  "function executeBatch((address target,uint256 value,bytes data)[] calls)",
]);
const TOKEN_ABI = parseAbi(["function transfer(address to,uint256 value) returns (bool)"]);

type RawCall = NonNullable<RpcPort["coinbaseGaslessCall"]>;
type RawLogs = NonNullable<RpcPort["coinbaseGaslessLogs"]>;

export interface CoinbaseGaslessSnapshot {
  readonly rpcOrigin: string;
  readonly safeBlock: CoinbaseGaslessBlock;
  readonly balanceAtomic: string;
  readonly entryPointCodeHash: Hex;
  readonly accountCodeHash: Hex;
  readonly accountImplementation: Address;
  readonly accountImplementationCodeHash: Hex;
}

export type CoinbaseGaslessObservation =
  | { readonly status: "not_found" | "pending" | "unresolved" | "ambiguous";
      readonly cursor: CoinbaseGaslessCursor; readonly reason: string }
  | { readonly status: "safe"; readonly cursor: CoinbaseGaslessCursor;
      readonly settlement: CoinbaseGaslessSettlement };

export async function coinbaseGaslessSnapshot(rpc: RpcPort, sender: Address): Promise<CoinbaseGaslessSnapshot> {
  const { rpcOrigin } = await rpc.assertBaseChain();
  const call = requiredCall(rpc);
  const safe = block(await call("eth_getBlockByNumber", ["safe", false]));
  // EIP-1898: every read is pinned to this canonical safe block, so no header recheck follows them.
  const tag = { blockHash: safe.hash, requireCanonical: true };
  const [balanceRaw, entryPointCode, accountCode, implementationWord, accountEntryPoint, accountImplementation] = await Promise.all([
    call("eth_call", [{ to: BASE_USDC, data: `0x70a08231${sender.slice(2).toLowerCase().padStart(64, "0")}` }, tag]),
    call("eth_getCode", [COINBASE_ENTRY_POINT, tag]), call("eth_getCode", [sender, tag]),
    call("eth_getStorageAt", [sender, EIP1967_IMPLEMENTATION_SLOT, tag]),
    call("eth_call", [{ to: sender, data: ENTRY_POINT_SELECTOR }, tag]),
    call("eth_call", [{ to: sender, data: IMPLEMENTATION_SELECTOR }, tag]),
  ]);
  const implementation = wordAddress(implementationWord);
  const [implementationCode, implementationEntryPoint] = await Promise.all([
    call("eth_getCode", [implementation, tag]), call("eth_call", [{ to: implementation, data: ENTRY_POINT_SELECTOR }, tag]),
  ]);
  const epCode = nonemptyCode(entryPointCode), ownerCode = nonemptyCode(accountCode), implCode = nonemptyCode(implementationCode);
  if (keccak256(epCode) !== COINBASE_ENTRY_POINT_CODE_HASH || keccak256(ownerCode) !== COINBASE_ACCOUNT_CODE_HASH ||
    implementation !== COINBASE_ACCOUNT_IMPLEMENTATION || wordAddress(accountImplementation) !== implementation ||
    keccak256(implCode) !== COINBASE_ACCOUNT_IMPLEMENTATION_CODE_HASH || wordAddress(accountEntryPoint) !== COINBASE_ENTRY_POINT ||
    wordAddress(implementationEntryPoint) !== COINBASE_ENTRY_POINT) fail("coinbase_gasless_account_contract_unsupported");
  return { rpcOrigin, safeBlock: safe, balanceAtomic: uintWord(balanceRaw).toString(),
    entryPointCodeHash: keccak256(epCode), accountCodeHash: keccak256(ownerCode),
    accountImplementation: implementation, accountImplementationCodeHash: keccak256(implCode) };
}

export async function observeCoinbaseGasless(rpc: RpcPort, operation: OperationRecord, logsRpc?: RpcPort): Promise<CoinbaseGaslessObservation> {
  const binding = operation.providerDirect?.coinbaseGasless;
  if (binding === undefined) fail("coinbase_gasless_binding_missing", "APN_STATE_CORRUPT");
  const call = requiredCall(rpc), logs = requiredLogs(logsRpc ?? rpc);
  const identity = await rpc.assertBaseChain();
  // Any Base endpoint may observe; only the logs preset records the frozen call origin as its provenance.
  if (logsRpc !== undefined && identity.rpcOrigin !== binding.rpcOrigin) return unresolved(operation, "coinbase_gasless_rpc_origin_changed");
  try {
    const logsCall = logsRpc === undefined ? undefined : requiredCall(logsRpc);
    if (logsRpc !== undefined) {
      const identity = await logsRpc.assertBaseChain();
      if (identity.chainId !== CHAIN_ID || identity.rpcOrigin !== COINBASE_OBSERVATION_ORIGIN) fail("coinbase_gasless_logs_origin_changed");
      await assertBlock(logsCall!, binding.safeBlock);
    }
    // No state is read at the prepare block: the effect is proven from the receipt of a transaction at or below safe.
    if (operation.coinbaseGaslessCursor?.previousEndBlock !== null && operation.coinbaseGaslessCursor?.previousEndBlock !== undefined) {
      await assertBlock(call, operation.coinbaseGaslessCursor.previousEndBlock);
    }
    const safe = block(await call("eth_getBlockByNumber", ["safe", false]));
    const start = BigInt(operation.coinbaseGaslessCursor?.nextBlockAtomic ??
      (BigInt(binding.safeBlock.numberAtomic) + 1n).toString());
    if (BigInt(safe.numberAtomic) < start) return { status: "pending", cursor: cursor(operation, null), reason: "coinbase_gasless_safe_head_before_cursor" };
    // The logs endpoint must serve the same canonical safe block; safe blocks do not reorg, so nothing is rechecked later.
    if (logsCall !== undefined) await assertBlock(logsCall, safe);
    const locator = operation.coinbaseGaslessLocator;
    let locatorTransaction: Hex | null = null;
    if (locator !== undefined && await call("eth_getTransactionByHash", [locator.hash]) !== null) locatorTransaction = locator.hash;
    const scanned = await scanRange(logs, binding, operation, locator?.hash ?? null, start, BigInt(safe.numberAtomic));
    const end = scanned.end;
    const candidates = new Set<Hex>();
    if (locator !== undefined) {
      const locatorUserOperationTransaction = scanned.located.size === 1 ? [...scanned.located][0]! : null;
      if ((locatorTransaction !== null && locatorUserOperationTransaction !== null) || scanned.located.size > 1) {
        return ambiguous(operation, "coinbase_gasless_locator_namespace_ambiguous");
      }
      if (locatorTransaction !== null) candidates.add(locatorTransaction);
      if (locatorUserOperationTransaction !== null) candidates.add(locatorUserOperationTransaction);
    }
    for (const candidate of scanned.transfers) candidates.add(candidate);
    if (candidates.size > 1) return ambiguous(operation, "coinbase_gasless_multiple_candidates");
    const candidate = [...candidates][0];
    if (candidate !== undefined) {
      const inspected = await inspectCandidate(call, operation, binding, candidate, safe);
      if (inspected !== null) {
        const settlement = logsRpc === undefined ? inspected : withObservationSource(inspected, binding.rpcOrigin);
        return { status: "safe", cursor: cursor(operation, null), settlement };
      }
    }
    const endBlock = end === BigInt(safe.numberAtomic) ? safe : block(await call("eth_getBlockByNumber", [quantity(end), false]));
    if (logsCall !== undefined && endBlock !== safe) await assertBlock(logsCall, endBlock);
    return { status: "not_found", cursor: { nextBlockAtomic: (end + 1n).toString(), previousEndBlock: endBlock },
      reason: "coinbase_gasless_no_positive_match" };
  } catch (error) {
    if (error instanceof CoinbaseObservationAmbiguity) return ambiguous(operation, error.message);
    return unresolved(operation, "coinbase_gasless_observation_unresolved");
  }
}

/**
 * Scans [start, safeEnd] window by window. Each window is committed only when all of its queries succeeded; a
 * candidate stops the pass. Throws the refusal when not even one window could be read.
 */
async function scanRange(logs: RawLogs, binding: CoinbaseGaslessBinding, operation: OperationRecord, locatorHash: Hex | null,
  start: bigint, safeEnd: bigint): Promise<{ readonly end: bigint; readonly located: Set<Hex>; readonly transfers: Set<Hex> }> {
  const located = new Set<Hex>(), transfers = new Set<Hex>();
  let from = start, window = LOG_WINDOW, queries = 0, end: bigint | null = null, refusal: unknown;
  while (from <= safeEnd && queries + (locatorHash === null ? 1 : 2) <= MAX_LOG_QUERIES_PER_PASS) {
    const to = minimum(safeEnd, from + window - 1n);
    let windowLocated: Set<Hex> = new Set(), windowTransfers: Set<Hex>;
    try {
      if (locatorHash !== null) { queries += 1; windowLocated = await scanUserOperation(logs, binding, operation.walletAddress, locatorHash, from, to); }
      queries += 1; windowTransfers = await scanTransfers(logs, operation, from, to);
    } catch (error) {
      refusal = error;
      // The log helper answers a range refusal, a pruned range or an over-bound result as APN_RPC_AMBIGUOUS.
      if (error instanceof ApnError && error.code === "APN_RPC_AMBIGUOUS" && window > 1n) { window /= 2n; continue; }
      break;
    }
    for (const hash of windowLocated) located.add(hash);
    for (const hash of windowTransfers) transfers.add(hash);
    end = to; from = to + 1n;
    if (located.size > 0 || transfers.size > 0) break;
  }
  if (end === null) throw refusal ?? new ApnError("APN_RPC_AMBIGUOUS", "coinbase_gasless_log_budget", { reason: "coinbase_gasless_log_budget" });
  return { end, located, transfers };
}

async function inspectCandidate(call: RawCall, operation: OperationRecord, binding: CoinbaseGaslessBinding,
  transactionHash: Hex, safe: CoinbaseGaslessBlock): Promise<CoinbaseGaslessSettlement | null> {
  const [txRaw, receiptRaw] = await Promise.all([
    call("eth_getTransactionByHash", [transactionHash]), call("eth_getTransactionReceipt", [transactionHash]),
  ]);
  if (txRaw === null || receiptRaw === null) return null;
  const tx = record(txRaw), receipt = record(receiptRaw);
  if (rpcHash(tx.hash) !== transactionHash || rpcHash(receipt.transactionHash) !== transactionHash ||
    uint(receipt.status) !== 1n || address(tx.to) !== binding.entryPoint || uint(tx.value) !== 0n ||
    sameAddress(address(tx.from), operation.walletAddress)) throw new CoinbaseObservationAmbiguity("coinbase_gasless_outer_identity");
  const blockNumber = uint(receipt.blockNumber);
  if (BigInt(safe.numberAtomic) < blockNumber) return null;
  // One header read serves both the hash binding and the transaction-membership check.
  const blockRaw = record(await call("eth_getBlockByNumber", [quantity(blockNumber), false])), included = block(blockRaw);
  if (included.hash !== rpcHash(receipt.blockHash) || rpcHash(tx.blockHash) !== included.hash || uint(tx.blockNumber) !== blockNumber) return null;
  if (blockNumber <= BigInt(binding.safeBlock.numberAtomic)) {
    throw new CoinbaseObservationAmbiguity("coinbase_gasless_candidate_predates_safe_anchor");
  }
  const transactionIndex = uint(receipt.transactionIndex);
  if (!Array.isArray(blockRaw.transactions) || transactionIndex >= BigInt(blockRaw.transactions.length) ||
    blockRaw.transactions[Number(transactionIndex)] !== transactionHash || uint(tx.transactionIndex) !== transactionIndex) {
    throw new CoinbaseObservationAmbiguity("coinbase_gasless_transaction_membership");
  }
  const transactionInput = rpcHex(tx.input), decoded = decodeFunctionData({ abi: ENTRY_POINT_ABI, data: transactionInput });
  if (decoded.functionName !== "handleOps") throw new CoinbaseObservationAmbiguity("coinbase_gasless_entrypoint_call");
  if (encodeFunctionData({ abi: ENTRY_POINT_ABI, functionName: "handleOps", args: decoded.args }) !== transactionInput) {
    throw new CoinbaseObservationAmbiguity("coinbase_gasless_entrypoint_encoding");
  }
  const ops = decoded.args[0];
  if (ops.length > 128) throw new CoinbaseObservationAmbiguity("coinbase_gasless_bundle_bound");
  const selected = ops.filter(op => sameAddress(getAddress(op.sender), operation.walletAddress));
  if (selected.length !== 1) throw new CoinbaseObservationAmbiguity("coinbase_gasless_bundle_sender_ambiguity");
  const userOp = selected[0]!;
  const userOperationHash = v06UserOperationHash(userOp, binding.entryPoint);
  const paymaster = paymasterAddress(userOp.paymasterAndData);
  if (paymaster === ZERO_ADDRESS) throw new CoinbaseObservationAmbiguity("coinbase_gasless_paymaster_missing");
  assertExactAccountCall(userOp.callData, operation);
  const rawLogs = receiptLogs(receipt.logs, transactionHash, included, transactionIndex);
  const event = rawLogs.filter(log => log.address === binding.entryPoint && log.topics.length === 4 &&
    log.topics[0] === USER_OPERATION_EVENT && log.topics[1] === userOperationHash &&
    log.topics[2] === addressWord(operation.walletAddress) && log.topics[3] === addressWord(paymaster));
  if (event.length !== 1) throw new CoinbaseObservationAmbiguity("coinbase_gasless_user_operation_event");
  const [nonce, success] = decodeAbiParameters(parseAbiParameters("uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed"), event[0]!.data);
  if (!success || nonce !== userOp.nonce) throw new CoinbaseObservationAmbiguity("coinbase_gasless_user_operation_result");
  const senderDebits = rawLogs.filter(log => log.topics[0] === TRANSFER_TOPIC &&
    log.topics[1] === addressWord(operation.walletAddress));
  if (senderDebits.length !== 1 || senderDebits[0]!.address !== BASE_USDC || senderDebits[0]!.topics.length !== 3 ||
    senderDebits[0]!.topics[2] !== addressWord(operation.recipient) ||
    uintWord(senderDebits[0]!.data).toString() !== operation.amountAtomic) {
    throw new CoinbaseObservationAmbiguity("coinbase_gasless_usdc_accounting");
  }
  // The effect is the receipt: EntryPoint v0.6 (immutable, fixed address) emitted the exact UserOperationEvent and USDC
  // emitted exactly one sender debit to the recipient. No code or storage is read at the inclusion block (archive state);
  // the paymaster's code is read once at the current head only to record its identity.
  const paymasterCode = nonemptyCode(await call("eth_getCode", [paymaster, "latest"]));
  const body = { schemaVersion: "apn.coinbase-gasless-settlement.v1" as const, userOperationHash, transactionHash,
    nonceAtomic: nonce.toString(), paymaster, paymasterCodeHash: keccak256(paymasterCode), block: included,
    safeBlock: safe, grossAtomic: operation.amountAtomic, netAtomic: operation.amountAtomic, feeAtomic: "0" as const,
    senderNativeDebitWei: "0" as const };
  return { ...body, evidenceHash: hashObject(body) };
}

async function scanUserOperation(logs: RawLogs, binding: CoinbaseGaslessBinding, sender: Address,
  hash: Hex, start: bigint, end: bigint): Promise<Set<Hex>> {
  const candidates = new Set<Hex>();
  const rows = await logs({ address: binding.entryPoint, fromBlock: quantity(start), toBlock: quantity(end),
    topics: [USER_OPERATION_EVENT, hash, addressWord(sender)] });
  for (const item of rows) {
    const log = rpcLog(item);
    if (log.address !== binding.entryPoint || log.topics.length !== 4 || log.topics[0] !== USER_OPERATION_EVENT ||
      log.topics[1] !== hash || log.topics[2] !== addressWord(sender) || !inRange(log.blockNumberAtomic, start, end)) {
      fail("coinbase_gasless_userop_filter_identity");
    }
    candidates.add(log.transactionHash);
  }
  return candidates;
}

async function scanTransfers(logs: RawLogs, operation: OperationRecord, start: bigint, end: bigint): Promise<Set<Hex>> {
  const candidates = new Set<Hex>();
  const rows = await logs({ address: BASE_USDC, fromBlock: quantity(start), toBlock: quantity(end),
    topics: [TRANSFER_TOPIC, addressWord(operation.walletAddress), addressWord(operation.recipient)] });
  for (const item of rows) {
    const log = rpcLog(item);
    if (log.address !== BASE_USDC || log.topics.length !== 3 || log.topics[0] !== TRANSFER_TOPIC ||
      log.topics[1] !== addressWord(operation.walletAddress) || log.topics[2] !== addressWord(operation.recipient) ||
      !inRange(log.blockNumberAtomic, start, end)) {
      fail("coinbase_gasless_transfer_filter_identity");
    }
    if (uintWord(log.data).toString() === operation.amountAtomic) candidates.add(log.transactionHash);
  }
  return candidates;
}

function assertExactAccountCall(callData: Hex, operation: OperationRecord): void {
  const decoded = decodeFunctionData({ abi: ACCOUNT_ABI, data: callData });
  const canonicalAccountCall = decoded.functionName === "execute"
    ? encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "execute", args: decoded.args })
    : encodeFunctionData({ abi: ACCOUNT_ABI, functionName: "executeBatch", args: decoded.args });
  if (canonicalAccountCall !== callData) throw new CoinbaseObservationAmbiguity("coinbase_gasless_account_encoding");
  const calls = decoded.functionName === "execute"
    ? [{ target: decoded.args[0], value: decoded.args[1], data: decoded.args[2] }]
    : decoded.args[0];
  if (calls.length !== 1) throw new CoinbaseObservationAmbiguity("coinbase_gasless_extra_account_calls");
  const call = calls[0]!;
  if (getAddress(call.target) !== BASE_USDC || call.value !== 0n) throw new CoinbaseObservationAmbiguity("coinbase_gasless_inner_identity");
  const transfer = decodeFunctionData({ abi: TOKEN_ABI, data: call.data });
  if (transfer.functionName !== "transfer" || !sameAddress(getAddress(transfer.args[0]), operation.recipient) ||
    transfer.args[1].toString() !== operation.amountAtomic) throw new CoinbaseObservationAmbiguity("coinbase_gasless_inner_transfer");
  if (encodeFunctionData({ abi: TOKEN_ABI, functionName: "transfer", args: transfer.args }) !== call.data) {
    throw new CoinbaseObservationAmbiguity("coinbase_gasless_inner_transfer_encoding");
  }
}

function v06UserOperationHash(op: { readonly sender: Address; readonly nonce: bigint; readonly initCode: Hex; readonly callData: Hex;
  readonly callGasLimit: bigint; readonly verificationGasLimit: bigint; readonly preVerificationGas: bigint;
  readonly maxFeePerGas: bigint; readonly maxPriorityFeePerGas: bigint; readonly paymasterAndData: Hex }, entryPoint: Address): Hex {
  const packed = encodeAbiParameters(parseAbiParameters("address sender,uint256 nonce,bytes32 initCodeHash,bytes32 callDataHash,uint256 callGasLimit,uint256 verificationGasLimit,uint256 preVerificationGas,uint256 maxFeePerGas,uint256 maxPriorityFeePerGas,bytes32 paymasterAndDataHash"),
    [op.sender, op.nonce, keccak256(op.initCode), keccak256(op.callData), op.callGasLimit, op.verificationGasLimit,
      op.preVerificationGas, op.maxFeePerGas, op.maxPriorityFeePerGas, keccak256(op.paymasterAndData)]);
  return keccak256(encodeAbiParameters(parseAbiParameters("bytes32 userOpHash,address entryPoint,uint256 chainId"),
    [keccak256(packed), entryPoint, BigInt(CHAIN_ID)]));
}

function paymasterAddress(value: Hex): Address {
  if (value.length < 42) return ZERO_ADDRESS;
  return getAddress(`0x${value.slice(2, 42)}`) as Address;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function receiptLogs(value: unknown, transactionHash: Hex, included: CoinbaseGaslessBlock, transactionIndex: bigint) {
  if (!Array.isArray(value) || value.length > 512) fail("coinbase_gasless_receipt_logs");
  const indexes = new Set<string>();
  return value.map(item => {
    const log = rpcLog(item);
    if (log.transactionHash !== transactionHash || log.blockHash !== included.hash ||
      log.blockNumberAtomic !== included.numberAtomic || log.transactionIndexAtomic !== transactionIndex.toString() ||
      indexes.has(log.logIndexAtomic)) fail("coinbase_gasless_receipt_log_membership");
    indexes.add(log.logIndexAtomic);
    return log;
  });
}

function rpcLog(value: unknown) {
  const log = record(value);
  if (!Array.isArray(log.topics) || log.removed !== false) fail("coinbase_gasless_log_schema");
  return { address: address(log.address), topics: log.topics.map(rpcHash), data: rpcHex(log.data),
    transactionHash: rpcHash(log.transactionHash), blockHash: rpcHash(log.blockHash),
    blockNumberAtomic: uint(log.blockNumber).toString(), transactionIndexAtomic: uint(log.transactionIndex).toString(),
    logIndexAtomic: uint(log.logIndex).toString() };
}
function cursor(operation: OperationRecord, previousEndBlock: CoinbaseGaslessBlock | null): CoinbaseGaslessCursor {
  return operation.coinbaseGaslessCursor ?? {
    nextBlockAtomic: (BigInt(operation.providerDirect!.coinbaseGasless!.safeBlock.numberAtomic) + 1n).toString(), previousEndBlock,
  };
}
function unresolved(operation: OperationRecord, reason: string): CoinbaseGaslessObservation {
  return { status: "unresolved", cursor: cursor(operation, null), reason };
}
function ambiguous(operation: OperationRecord, reason: string): CoinbaseGaslessObservation {
  return { status: "ambiguous", cursor: cursor(operation, null), reason };
}
function requiredCall(rpc: RpcPort): RawCall {
  if (rpc.coinbaseGaslessCall === undefined) fail("coinbase_gasless_rpc_unavailable", "APN_RPC_CONFIG");
  return rpc.coinbaseGaslessCall.bind(rpc);
}
function requiredLogs(rpc: RpcPort): RawLogs {
  if (rpc.coinbaseGaslessLogs === undefined) fail("coinbase_gasless_rpc_unavailable", "APN_RPC_CONFIG");
  return rpc.coinbaseGaslessLogs.bind(rpc);
}
function block(value: unknown): CoinbaseGaslessBlock {
  const row = record(value); return { numberAtomic: uint(row.number).toString(), hash: rpcHash(row.hash),
    timestampAtomic: uint(row.timestamp).toString() };
}
async function assertBlock(call: RawCall, expected: CoinbaseGaslessBlock): Promise<void> {
  if (!sameBlock(block(await call("eth_getBlockByNumber", [quantity(BigInt(expected.numberAtomic)), false])), expected)) {
    fail("coinbase_gasless_block_reorg");
  }
}
function sameBlock(a: CoinbaseGaslessBlock, b: CoinbaseGaslessBlock): boolean {
  return a.numberAtomic === b.numberAtomic && a.hash === b.hash && a.timestampAtomic === b.timestampAtomic;
}
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("coinbase_gasless_rpc_record");
  return value as Record<string, unknown>;
}
function address(value: unknown): Address {
  try { if (typeof value !== "string") throw new Error(); return getAddress(value) as Address; }
  catch { return fail("coinbase_gasless_rpc_address"); }
}
function wordAddress(value: unknown): Address {
  const word = rpcHash(value); return getAddress(`0x${word.slice(-40)}`) as Address;
}
function uint(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u.test(value) || value.length > 66) fail("coinbase_gasless_rpc_quantity");
  return BigInt(value);
}
function uintWord(value: unknown): bigint { const v = rpcHash(value); return BigInt(v); }
function rpcHash(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value)) fail("coinbase_gasless_rpc_hash");
  return value.toLowerCase() as Hex;
}
function rpcHex(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value) || value.length > 2 + 512 * 1024) fail("coinbase_gasless_rpc_hex");
  return value.toLowerCase() as Hex;
}
function nonemptyCode(value: unknown): Hex { const code = rpcHex(value); if (code === "0x") fail("coinbase_gasless_code_missing"); return code; }
function addressWord(value: Address): Hex { return `0x${value.slice(2).toLowerCase().padStart(64, "0")}`; }
function quantity(value: bigint): Hex { if (value < 0n) fail("coinbase_gasless_quantity"); return `0x${value.toString(16)}`; }
function minimum(a: bigint, b: bigint): bigint { return a < b ? a : b; }
function inRange(numberAtomic: string, start: bigint, end: bigint): boolean { const n = BigInt(numberAtomic); return n >= start && n <= end; }
class CoinbaseObservationAmbiguity extends Error {}
function fail(reason: string, code: "APN_RPC_PROTOCOL" | "APN_RPC_CONFIG" | "APN_STATE_CORRUPT" = "APN_RPC_PROTOCOL"): never {
  throw new ApnError(code, reason, { reason });
}

function withObservationSource(settlement: CoinbaseGaslessSettlement, callRpcOrigin: string): CoinbaseGaslessSettlement {
  const { evidenceHash: _previous, ...body } = settlement;
  const observationSource = { policy: "apn.coinbase-gasless.observation-source.v1" as const,
    callRpcOrigin, logsRpcOrigin: COINBASE_OBSERVATION_ORIGIN, preset: "publicnode-base" as const };
  const sourced = { ...body, observationSource };
  return { ...sourced, evidenceHash: hashObject(sourced) };
}
