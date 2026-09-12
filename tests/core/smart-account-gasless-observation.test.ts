import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hex } from "../../src/model.js";
import { SaRpcBudgetError, SaRpcRangeError, SaRpcReorgError } from
  "../../src/smart-account-gasless/chain/abi.js";
import { observeSmartAccountGasless, type SmartAccountObservationContext } from
  "../../src/smart-account-gasless/chain/observation.js";
import { advanceSmartAccountGaslessScan, initialSmartAccountGaslessCursor } from
  "../../src/smart-account-gasless/chain/scan.js";
import type { SmartAccountGaslessBlock, SmartAccountGaslessIntent } from
  "../../src/smart-account-gasless/model.js";
import type { SmartAccountGaslessObserveInput } from "../../src/smart-account-gasless/ports.js";
import { saRegistry } from "../../src/smart-account-gasless/registry.js";
import { SA_OUTER, SA_RUNTIME_CODES, saAddressTopic, saQuantity, saRawBlock, saRawReceiptLog, saReceiptLogs,
  saRedemptionFixture, saSignedOuter, saTestBlock, saWord, type Json } from
  "./smart-account-gasless-chain-fixtures.js";
import { SA_INCREASED_SPENT_TOPIC, SA_TRANSFER_TOPIC } from
  "../../src/smart-account-gasless/chain/abi.js";

type HarnessFault = "none" | "malformed_input" | "extra_outflow" | "wrong_child_event" |
  "wrong_safe_spend" | "multiple_candidates" | "unordered_logs" | "range_rejected" | "start_reorg";

interface Harness {
  readonly context: SmartAccountObservationContext;
  readonly input: SmartAccountGaslessObserveInput;
  readonly calls: Array<[string, readonly unknown[]]>;
  readonly transactionHash: Hex;
}

interface HarnessGeometry {
  readonly cursorOffset: bigint;
  readonly includedOffset: bigint;
  readonly safeOffset: bigint;
  readonly finalizedOffset: bigint;
}

function syntheticIntent(intent: SmartAccountGaslessIntent): SmartAccountGaslessIntent {
  const facilitator = SA_OUTER.address.toLowerCase() as Address;
  return { ...intent, provider: { ...intent.provider, facilitatorAddresses: [facilitator] },
    requirements: { ...intent.requirements, extra: { ...intent.requirements.extra,
      facilitatorAddresses: [facilitator] } } };
}

async function successHarness(fault: HarnessFault = "none", hint: Hex | null = null,
  geometry: HarnessGeometry = { cursorOffset: 0n, includedOffset: 3n, safeOffset: 10n,
    finalizedOffset: 9n }): Promise<Harness> {
  const fixture = saRedemptionFixture(), intent = syntheticIntent(fixture.intent), start = intent.initialSnapshot.preparationBlock;
  const safe = saTestBlock(BigInt(start.numberAtomic) + geometry.safeOffset,
    BigInt(start.timestampAtomic) + geometry.safeOffset * 2n);
  const finalized = saTestBlock(BigInt(start.numberAtomic) + geometry.finalizedOffset,
    BigInt(start.timestampAtomic) + geometry.finalizedOffset * 2n);
  const included = saTestBlock(BigInt(start.numberAtomic) + geometry.includedOffset,
    BigInt(start.timestampAtomic) + geometry.includedOffset * 2n);
  const signed = await saSignedOuter(2, fault === "malformed_input" ? "0x1234" : fixture.calldata, intent);
  const transaction = { ...signed.rpc, blockNumber: saQuantity(BigInt(included.numberAtomic)),
    blockHash: included.hash, transactionIndex: "0x0" };
  let logs = [...saReceiptLogs({ ...fixture, intent }, signed.hash, included)];
  if (fault === "extra_outflow") logs.push({ address: saRegistry(8453).token.address,
    topics: [SA_TRANSFER_TOPIC, saAddressTopic(intent.binding.ownerAddress), saAddressTopic(intent.binding.sessionAddress)],
    data: saWord(1n), logIndexAtomic: String(logs.length), transactionHash: signed.hash });
  if (fault === "wrong_child_event") logs = logs.map((log, index) => index === 3
    ? { ...log, topics: [log.topics[0]!, log.topics[1]!, log.topics[2]!, saWord(444n)] } : log);
  const receipt = { transactionHash: signed.hash, blockNumber: saQuantity(BigInt(included.numberAtomic)),
    blockHash: included.hash, transactionIndex: "0x0", type: signed.rpc.type,
    from: SA_OUTER.address.toLowerCase(), to: intent.binding.delegationManager, status: "0x1",
    logs: logs.map(log => saRawReceiptLog(log, signed.hash, included)) };
  const calls: Array<[string, readonly unknown[]]> = [];
  let startReads = 0;
  const blockAt = (tag: string): SmartAccountGaslessBlock => {
    if (tag === "safe") return safe;
    if (tag === "finalized") return finalized;
    const number = BigInt(tag);
    if (number === BigInt(start.numberAtomic)) {
      startReads += 1;
      return fault === "start_reorg" && startReads > 1 ? { ...start, hash: saWord(555n) } : start;
    }
    if (number === BigInt(included.numberAtomic)) return included;
    if (number === BigInt(safe.numberAtomic)) return safe;
    if (number === BigInt(finalized.numberAtomic)) return finalized;
    return saTestBlock(number, BigInt(start.timestampAtomic) + (number - BigInt(start.numberAtomic)) * 2n);
  };
  const childLog = saRawReceiptLog(logs[3]!, signed.hash, included);
  const secondHash = saWord(777n), secondChild = { ...childLog, transactionHash: secondHash, logIndex: "0x5" };
  const transferLog = saRawReceiptLog(logs[0]!, signed.hash, included);
  const call = async (method: any, params: readonly unknown[]) => {
    calls.push([method, params]);
    if (method === "eth_getBlockByNumber") {
      const block = blockAt(params[0] as string);
      return saRawBlock(block, block.hash === included.hash ? [signed.hash] : []);
    }
    if (method === "eth_getLogs") {
      if (fault === "range_rejected") throw new SaRpcRangeError();
      const filter = params[0] as Json;
      if (filter.address === saRegistry(8453).protocol.amount.address) {
        if (fault === "multiple_candidates") return [childLog, secondChild];
        if (fault === "unordered_logs") return [{ ...secondChild, logIndex: "0x5" },
          { ...childLog, transactionHash: secondHash, logIndex: "0x4" }];
        return [childLog];
      }
      return [transferLog];
    }
    if (method === "eth_getTransactionByHash") return params[0] === signed.hash ? transaction : null;
    if (method === "eth_getTransactionReceipt") return params[0] === signed.hash ? receipt : null;
    if (["eth_getCode", "eth_getStorageAt", "eth_call"].includes(method)) {
      return proofRead(method, params, intent, fault === "wrong_safe_spend" ? "9999" : intent.request.grossAtomic);
    }
    throw new Error(`unexpected ${method}`);
  };
  const context: SmartAccountObservationContext = { call, clock: { now: () => new Date(intent.preparedAt) },
    validator: fixture.validator };
  const initial = initialSmartAccountGaslessCursor(intent), previousNumber = BigInt(start.numberAtomic) + geometry.cursorOffset - 1n;
  const cursor = geometry.cursorOffset === 0n ? initial : { ...initial,
    nextBlockAtomic: (BigInt(start.numberAtomic) + geometry.cursorOffset).toString(),
    previousEndBlock: saTestBlock(previousNumber, BigInt(start.timestampAtomic) + (geometry.cursorOffset - 1n) * 2n) };
  const input: SmartAccountGaslessObserveInput = { operationId: "sa-chain-test", fingerprint: "6".repeat(64), intent,
    material: fixture.material, cursor, transactionHint: hint };
  return { context, input, calls, transactionHash: signed.hash };
}

test("independent child-event scan discovers exact success without a provider hint", async () => {
  const harness = await successHarness(), result = await observeSmartAccountGasless(harness.context, harness.input);
  assert.equal(result.observation.phase, "success"); assert.equal(result.observation.reason, null);
  assert.equal(result.observation.candidateTxHash, harness.transactionHash);
  assert.equal(result.settlement?.source, "rpc_discovered");
  assert.equal(result.settlement?.txHash, harness.transactionHash);
  assert.equal(result.settlement?.contextHash, harness.input.material.permissionContextHash);
  assert.equal(result.settlement?.feeAtomic, "0"); assert.equal(result.settlement?.deliveredAtomic, "10000");
  assert.ok(result.observation.evidenceHash); assert.ok(harness.calls.length <= 64);
});

test("independent match wins over an unrelated provider hint", async () => {
  const harness = await successHarness("none", saWord(888n));
  const result = await observeSmartAccountGasless(harness.context, harness.input);
  assert.equal(result.observation.phase, "success"); assert.equal(result.settlement?.source, "rpc_discovered");
  assert.equal(harness.calls.some(([method, params]) => method === "eth_getTransactionByHash" && params[0] === saWord(888n)), false);
});

test("matching provider hint is tagged without replacing independent chain proof", async () => {
  const first = await successHarness(), harness = await successHarness("none", first.transactionHash);
  const result = await observeSmartAccountGasless(harness.context, harness.input);
  assert.equal(result.observation.phase, "success"); assert.equal(result.settlement?.source, "provider_hint");
  assert.equal(result.settlement?.txHash, harness.transactionHash);
});

test("an expired hinted transaction 37 blocks ahead checkpoints its completed scan before paced proof resumes", async () => {
  const geometry = { cursorOffset: 88n, includedOffset: 125n, safeOffset: 175n, finalizedOffset: 170n };
  const harness = await successHarness("none", null, geometry);
  const input = { ...harness.input, transactionHint: harness.transactionHash };
  let elapsed = 0, firstStarts = 0;
  const pacedCall = async (method: any, params: readonly unknown[]) => {
    if (elapsed >= 45_000) throw new SaRpcBudgetError();
    elapsed += 1_000; firstStarts += 1;
    if (method === "eth_chainId") return "0x2105";
    return await harness.context.call(method, params);
  };
  await pacedCall("eth_chainId", []);
  const first = await observeSmartAccountGasless({ ...harness.context, call: pacedCall }, input);
  assert.equal(first.observation.phase, "pending"); assert.equal(first.observation.reason, "sa_gasless_partial");
  assert.equal(first.observation.candidateTxHash, harness.transactionHash); assert.equal(first.settlement, null);
  assert.ok(BigInt(first.cursor.nextBlockAtomic) > BigInt(input.cursor.nextBlockAtomic));
  assert.deepEqual(first.cursor.candidateHashes, [harness.transactionHash]); assert.ok(first.cursor.expiryBlock);
  assert.equal(firstStarts, 45);

  let secondStarts = 0;
  const resumedCall = async (method: any, params: readonly unknown[]) => {
    secondStarts += 1;
    if (secondStarts > 45) throw new SaRpcBudgetError();
    if (method === "eth_chainId") return "0x2105";
    return await harness.context.call(method, params);
  };
  await resumedCall("eth_chainId", []);
  const settled = await observeSmartAccountGasless({ ...harness.context, call: resumedCall }, { ...input, cursor: first.cursor });
  assert.equal(settled.observation.phase, "success"); assert.equal(settled.settlement?.txHash, harness.transactionHash);
  assert.ok(secondStarts <= 45);

  const previous = first.cursor.previousEndBlock!;
  const changedCall = async (method: any, params: readonly unknown[]) => method === "eth_getBlockByNumber" &&
    typeof params[0] === "string" && /^0x[0-9a-f]+$/u.test(params[0]) &&
    BigInt(params[0]) === BigInt(previous.numberAtomic)
    ? saRawBlock({ ...previous, hash: saWord(999n) }) : await harness.context.call(method, params);
  const changed = await observeSmartAccountGasless({ ...harness.context, call: changedCall }, { ...input, cursor: first.cursor });
  assert.equal(changed.observation.phase, "reorg"); assert.equal(changed.settlement, null);

  const tamperedHash = saWord(998n), tamperedCursor = { ...first.cursor, candidateHashes: [tamperedHash] };
  const tampered = await observeSmartAccountGasless(harness.context,
    { ...input, cursor: tamperedCursor, transactionHint: tamperedHash });
  assert.equal(tampered.observation.phase, "pending"); assert.equal(tampered.settlement, null);
});

test("altered calldata, receipt events, outflow or final spent state cannot complete", async () => {
  for (const fault of ["malformed_input", "extra_outflow", "wrong_child_event", "wrong_safe_spend"] as const) {
    const harness = await successHarness(fault), result = await observeSmartAccountGasless(harness.context, harness.input);
    assert.equal(result.observation.phase, "invalid", fault); assert.equal(result.settlement, null, fault);
  }
});

test("multiple candidates, range rejection and cursor reorg remain guarded", async () => {
  const multiple = await successHarness("multiple_candidates");
  const ambiguous = await observeSmartAccountGasless(multiple.context, multiple.input);
  assert.equal(ambiguous.observation.phase, "pending"); assert.equal(ambiguous.observation.reason, "sa_gasless_unknown");
  assert.equal(ambiguous.cursor.candidateHashes.length, 2);

  const unordered = await successHarness("unordered_logs");
  const unsorted = await observeSmartAccountGasless(unordered.context, unordered.input);
  assert.equal(unsorted.observation.phase, "invalid"); assert.deepEqual(unsorted.cursor, unordered.input.cursor);

  const range = await successHarness("range_rejected");
  const partial = await observeSmartAccountGasless(range.context, range.input);
  assert.equal(partial.observation.reason, "sa_gasless_partial"); assert.deepEqual(partial.cursor, range.input.cursor);

  const reorg = await successHarness("start_reorg");
  const changed = await observeSmartAccountGasless(reorg.context, reorg.input);
  assert.equal(changed.observation.phase, "reorg"); assert.deepEqual(changed.cursor, reorg.input.cursor);
});

test("safe lag behind the frozen preparation anchor remains pending", async () => {
  const fixture = saRedemptionFixture(), intent = syntheticIntent(fixture.intent), start = intent.initialSnapshot.preparationBlock;
  const safe = saTestBlock(BigInt(start.numberAtomic) - 1n, BigInt(start.timestampAtomic) - 2n);
  const finalized = saTestBlock(BigInt(start.numberAtomic) - 2n, BigInt(start.timestampAtomic) - 4n);
  const call = async (method: any, params: readonly unknown[]) => {
    assert.equal(method, "eth_getBlockByNumber");
    const block = params[0] === "safe" ? safe : params[0] === "finalized" ? finalized :
      BigInt(params[0] as string) === BigInt(start.numberAtomic) ? start : safe;
    return saRawBlock(block);
  };
  const input: SmartAccountGaslessObserveInput = { operationId: "sa-lag-test", fingerprint: "6".repeat(64), intent,
    material: fixture.material, cursor: initialSmartAccountGaslessCursor(intent), transactionHint: null };
  const result = await observeSmartAccountGasless({ call, clock: { now: () => new Date(intent.preparedAt) },
    validator: fixture.validator }, input);
  assert.equal(result.observation.phase, "pending"); assert.deepEqual(result.cursor, input.cursor);
});

test("a reused cursor rejects a safe head below its previous end before selecting a candidate", async () => {
  const fixture = saRedemptionFixture(), intent = syntheticIntent(fixture.intent);
  const start = intent.initialSnapshot.preparationBlock, startNumber = BigInt(start.numberAtomic);
  const previousEndBlock = saTestBlock(startNumber + 2n, BigInt(start.timestampAtomic) + 4n);
  const safe = saTestBlock(startNumber + 1n, BigInt(start.timestampAtomic) + 2n);
  const candidate = saWord(808n);
  const cursor = { ...initialSmartAccountGaslessCursor(intent),
    nextBlockAtomic: (startNumber + 3n).toString(), previousEndBlock, candidateHashes: [candidate] };
  const call = async (method: any, params: readonly unknown[]) => {
    assert.equal(method, "eth_getBlockByNumber");
    if (params[0] === "safe") return saRawBlock(safe);
    if (params[0] === "finalized") return saRawBlock(start);
    const number = BigInt(params[0] as string);
    if (number === startNumber) return saRawBlock(start);
    if (number === BigInt(previousEndBlock.numberAtomic)) return saRawBlock(previousEndBlock);
    if (number === BigInt(safe.numberAtomic)) return saRawBlock(safe);
    throw new Error(`unexpected block ${String(params[0])}`);
  };

  await assert.rejects(advanceSmartAccountGaslessScan(call, intent, fixture.material.childDelegationHash,
    cursor, safe), error => error instanceof SaRpcReorgError);

  const input: SmartAccountGaslessObserveInput = { operationId: "sa-regressed-head-test",
    fingerprint: "6".repeat(64), intent, material: fixture.material, cursor, transactionHint: candidate };
  const observed = await observeSmartAccountGasless({ call, clock: { now: () => new Date(intent.preparedAt) },
    validator: fixture.validator }, input);
  assert.equal(observed.observation.phase, "reorg");
  assert.equal(observed.observation.candidateTxHash, null);
  assert.equal(observed.settlement, null); assert.equal(observed.unusedProof, null);
  assert.deepEqual(observed.cursor, cursor);
});

interface ExpiryOptions { finalizedLag?: boolean; spent?: string; transfer?: boolean; zeroChild?: boolean }
async function expiryHarness(options: ExpiryOptions = {}): Promise<Harness> {
  const fixture = saRedemptionFixture(), intent = syntheticIntent(fixture.intent), start = intent.initialSnapshot.preparationBlock;
  const startNumber = BigInt(start.numberAtomic), headNumber = startNumber + 3n;
  const blocks = new Map<string, SmartAccountGaslessBlock>(); blocks.set(start.numberAtomic, start);
  for (let offset = 1n; offset <= 3n; offset += 1n) blocks.set((startNumber + offset).toString(),
    saTestBlock(startNumber + offset, BigInt(intent.afterUnix) + offset * 100n));
  const safe = blocks.get(headNumber.toString())!, finalized = blocks.get((headNumber - (options.finalizedLag ? 1n : 0n)).toString())!;
  const transferHash = saWord(901n), calls: Array<[string, readonly unknown[]]> = [];
  const scanBase = { address: saRegistry(8453).token.address,
    topics: [SA_TRANSFER_TOPIC, saAddressTopic(intent.binding.ownerAddress), saAddressTopic(intent.request.recipient)],
    data: saWord(BigInt(intent.request.grossAtomic)), logIndexAtomic: "0", transactionHash: transferHash };
  const childZero = { address: saRegistry(8453).protocol.amount.address,
    topics: [SA_INCREASED_SPENT_TOPIC, saAddressTopic(saRegistry(8453).protocol.manager.address),
      saAddressTopic(SA_OUTER.address.toLowerCase() as Address), fixture.material.childDelegationHash],
    data: `${saWord(0n)}${saWord(0n).slice(2)}` as Hex, logIndexAtomic: "0", transactionHash: transferHash };
  const call = async (method: any, params: readonly unknown[]) => {
    calls.push([method, params]);
    if (method === "eth_getBlockByNumber") {
      const block = params[0] === "safe" ? safe : params[0] === "finalized" ? finalized :
        blocks.get(BigInt(params[0] as string).toString());
      if (block === undefined) throw new Error("missing block");
      return saRawBlock(block);
    }
    if (method === "eth_getLogs") {
      const filter = params[0] as Json;
      if (filter.address === saRegistry(8453).protocol.amount.address && options.zeroChild) {
        return [saRawReceiptLog(childZero, transferHash, safe)];
      }
      if (filter.address === saRegistry(8453).token.address && options.transfer) {
        return [saRawReceiptLog(scanBase, transferHash, safe)];
      }
      return [];
    }
    if (method === "eth_getTransactionByHash" || method === "eth_getTransactionReceipt") return null;
    if (["eth_getCode", "eth_getStorageAt", "eth_call"].includes(method)) {
      return proofRead(method, params, intent, options.spent ?? "0");
    }
    throw new Error(`unexpected ${method}`);
  };
  const context: SmartAccountObservationContext = { call, clock: { now: () => new Date(intent.expiresAt) },
    validator: fixture.validator };
  const input: SmartAccountGaslessObserveInput = { operationId: "sa-expiry-test", fingerprint: "6".repeat(64), intent,
    material: fixture.material, cursor: initialSmartAccountGaslessCursor(intent), transactionHint: null };
  return { context, input, calls, transactionHash: transferHash };
}

test("only finalized complete zero scans produce an expired-unused proof", async () => {
  const complete = await expiryHarness(), result = await observeSmartAccountGasless(complete.context, complete.input);
  assert.equal(result.observation.phase, "expired_unused"); assert.equal(result.observation.reason, null);
  assert.ok(result.observation.evidenceHash); assert.equal(result.unusedProof?.childSpentAtomic, "0");
  assert.equal(result.cursor.childScanComplete, true); assert.equal(result.cursor.transferScanComplete, true);
  assert.equal(result.cursor.expiryBlock?.timestampAtomic, String(complete.input.intent.beforeUnix));

  for (const options of [{ finalizedLag: true }, { spent: "1" }, { transfer: true }, { zeroChild: true }]) {
    const harness = await expiryHarness(options), held = await observeSmartAccountGasless(harness.context, harness.input);
    assert.equal(held.observation.phase, "pending"); assert.equal(held.unusedProof, null);
  }
});

function proofRead(method: string, params: readonly unknown[], intent: SmartAccountGaslessIntent,
  spentAtomic: string): unknown {
  const registry = saRegistry(8453);
  if (method === "eth_getCode") {
    const address = String(params[0]).toLowerCase() as Address;
    if (address === intent.binding.ownerAddress) return registry.ownerDesignationCode;
    if (address === intent.binding.sessionAddress) return "0x";
    const code = (SA_RUNTIME_CODES as Readonly<Record<string, Hex>>)[address];
    if (code === undefined) throw new Error(`missing code ${address}`);
    return code;
  }
  if (method === "eth_getStorageAt") return saWord(BigInt(registry.token.implementationAddress));
  const selector = String((params[0] as Json).data).slice(0, 10);
  if (selector === "0x313ce567") return saWord(6n);
  if (selector === "0x3644e515") return registry.token.domainSeparator;
  if (selector === "0x9dd5d9ab") return saWord(BigInt(spentAtomic));
  throw new Error(`unexpected proof read ${selector}`);
}

test("budget exhaustion preserves a truthful unadvanced scan cursor", async () => {
  const fixture = saRedemptionFixture(), intent = syntheticIntent(fixture.intent), cursor = initialSmartAccountGaslessCursor(intent);
  let calls = 0;
  const result = await advanceSmartAccountGaslessScan(async () => {
    calls += 1; if (calls > 1) throw new SaRpcBudgetError(); return saRawBlock(intent.initialSnapshot.preparationBlock);
  }, intent, fixture.material.childDelegationHash, cursor, saTestBlock(BigInt(cursor.startBlock.numberAtomic) + 2n));
  assert.equal(result.partial, true); assert.deepEqual(result.cursor, cursor);
});

test("range rejection halves the page without skipping the failed interval", async () => {
  const fixture = saRedemptionFixture(), intent = syntheticIntent(fixture.intent), cursor = initialSmartAccountGaslessCursor(intent);
  const start = BigInt(cursor.startBlock.numberAtomic), safe = saTestBlock(start + 3n,
    BigInt(cursor.startBlock.timestampAtomic) + 10n), ranges: Array<readonly [bigint, bigint]> = [];
  const call = async (method: any, params: readonly unknown[]) => {
    if (method === "eth_getBlockByNumber") {
      const number = BigInt(params[0] as string);
      return saRawBlock(number === start ? cursor.startBlock : number === start + 3n ? safe :
        saTestBlock(number, BigInt(cursor.startBlock.timestampAtomic) + number - start));
    }
    const filter = params[0] as Json, from = BigInt(filter.fromBlock), to = BigInt(filter.toBlock);
    ranges.push([from, to]); if (to - from + 1n > 2n) throw new SaRpcRangeError(); return [];
  };
  const result = await advanceSmartAccountGaslessScan(call, intent, fixture.material.childDelegationHash, cursor, safe);
  assert.equal(result.partial, false); assert.equal(result.cursor.nextBlockAtomic, (start + 2n).toString());
  assert.deepEqual(ranges, [[start, start + 3n], [start, start + 1n], [start, start + 1n]]);
  assert.equal(result.cursor.previousEndBlock?.numberAtomic, (start + 1n).toString());
});
