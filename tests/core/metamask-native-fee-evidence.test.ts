import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionData, getAddress } from "viem";
import { hashObject } from "../../src/canonical.js";
import { ApnError } from "../../src/errors.js";
import { directEvmListRows, directEvmNetwork } from "../../src/evm-direct-networks.js";
import type { EvmFeeQuote } from "../../src/evm-ports.js";
import type { Hex } from "../../src/model.js";
import {
  METAMASK_NATIVE_FEE_AMOUNT_ATOMIC,
  METAMASK_NATIVE_FEE_QUOTE_SCHEMA,
  METAMASK_NATIVE_FEE_RECEIPT_SCHEMA,
  METAMASK_NATIVE_FEE_SELLER,
  validateMetaMaskNativeFeeQuote,
  validateMetaMaskNativeFeeReceipt,
  type MetaMaskNativeFeeChainId,
  type MetaMaskNativeFeeQuote,
  type MetaMaskNativeFeeReceiptEvidence,
} from "../../src/metamask-native-fee-evidence.js";

const NOW = new Date("2026-10-10T00:00:30.000Z");
const ORIGIN = "https://rpc.example";
const SENDER = getAddress("0x1111111111111111111111111111111111111111");
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as Hex;
const TEST_CHAINS: readonly MetaMaskNativeFeeChainId[] = [1, 10, 143, 59144, 1329];
const ABI = [{
  type: "function", name: "transfer", stateMutability: "nonpayable",
  inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }],
}] as const;

test("validates finite native-fee quotes and derives exact receipt fees on the five selected chains", () => {
  for (const chainId of TEST_CHAINS) {
    const quote = makeQuote(chainId);
    assert.equal(validateMetaMaskNativeFeeQuote(quote, NOW), quote);
    const result = validateMetaMaskNativeFeeReceipt(makeReceipt(quote), quote);
    assert.equal(result.chainId, chainId);
    assert.equal(result.nativeSymbol, directEvmNetwork(chainId).nativeSymbol);
    assert.equal(result.nativeDecimals, 18);
    assert.equal(result.transferAccepted, true);
    assert.equal(result.disposition, "exact_transfer_confirmed");
    const expectedExecution = BigInt(chainId === 143 ? "65000" : "50000") * 150n;
    const expectedSurcharge = chainId === 10 ? 80n : 0n;
    assert.equal(result.nativeFeeAtomic, (expectedExecution + expectedSurcharge).toString());
  }
});

test("keeps a status-zero native charge separate from USDC acceptance", () => {
  const quote = makeQuote(1);
  const evidence = makeReceipt(quote, { status: "reverted", logs: [] });
  const result = validateMetaMaskNativeFeeReceipt(evidence, quote);
  assert.equal(result.nativeFeeAtomic, "7500000");
  assert.equal(result.transferAccepted, false);
  assert.equal(result.disposition, "reverted_fee_charged");
});

test("rejects quote changes, noncanonical tokens, calldata, and fees beyond the owner cap", () => {
  const quote = makeQuote(59144);
  assert.throws(() => validateMetaMaskNativeFeeQuote({ ...quote, grossAtomic: "1001" }, NOW));
  assert.throws(() => validateMetaMaskNativeFeeQuote({ ...quote, token: getAddress("0x2222222222222222222222222222222222222222") }, NOW));
  assert.throws(() => validateMetaMaskNativeFeeQuote({ ...quote, transaction: { ...quote.transaction, data: "0x" } }, NOW));
  assert.throws(() => validateMetaMaskNativeFeeQuote({ ...quote, nativeFeeCapAtomic: "1" }, NOW));
  assert.throws(() => validateMetaMaskNativeFeeQuote({ ...quote, quoteHash: "0".repeat(64) }, NOW));
  assert.throws(() => validateMetaMaskNativeFeeQuote(quote, new Date("2026-10-10T00:01:00.000Z")));
});

test("requires exact transaction fields, unique transfer log, and registered safe-head policy", () => {
  const quote = makeQuote(1329);
  const receipt = makeReceipt(quote);
  assert.throws(() => validateMetaMaskNativeFeeReceipt({ ...receipt, maxFeePerGasAtomic: "199" }, quote));
  assert.throws(() => validateMetaMaskNativeFeeReceipt({ ...receipt, logs: [] }, quote));
  assert.throws(() => validateMetaMaskNativeFeeReceipt({ ...receipt, safeHead: undefined }, quote));
  assert.throws(() => validateMetaMaskNativeFeeReceipt({
    ...receipt,
    logs: [{ ...receipt.logs[0]!, data: `0x${"0".repeat(61)}3e9` as Hex }],
  }, quote));
  assert.throws(() => validateMetaMaskNativeFeeReceipt({ ...receipt, status: "pending" } as unknown, quote));
  const duplicate = { ...receipt, logs: [...receipt.logs, receipt.logs[0]!] };
  assert.throws(() => validateMetaMaskNativeFeeReceipt(duplicate, quote));
  assert.throws(() => validateMetaMaskNativeFeeReceipt({ ...receipt, canonicalBlock: { ...receipt.receiptBlock, hash: `0x${"d".repeat(64)}` as Hex } }, quote));
});

test("fails closed when OP quote or actual surcharge evidence is incomplete", () => {
  const quote = makeQuote(10);
  assert.throws(() => validateMetaMaskNativeFeeQuote({
    ...quote,
    feeQuote: { ...quote.feeQuote, l1DataFeeUpperWei: "0", totalQuoteWei: quote.feeQuote.maximumExecutionFeeWei },
  }, NOW));
  const receipt = makeReceipt(quote);
  const withoutComponents = Object.fromEntries(Object.entries(receipt).filter(([key]) => key !== "opStackFeeComponents"));
  assert.throws(() => validateMetaMaskNativeFeeReceipt(withoutComponents, quote), (error: unknown) =>
    error instanceof ApnError && error.details?.reason === "op_receipt_surcharge_components_unavailable");
  assert.throws(() => validateMetaMaskNativeFeeReceipt({
    ...receipt,
    opStackFeeComponents: { ...receipt.opStackFeeComponents!, operatorFeeAtomic: "201" },
  }, quote));
});

test("rejects zero actual debit and fee quantities beyond the quote", () => {
  const quote = makeQuote(1);
  const zero = makeReceipt(quote, { effectiveGasPriceAtomic: "0" });
  assert.throws(() => validateMetaMaskNativeFeeReceipt(zero, quote));
  const tooMuch = makeReceipt(quote, { effectiveGasPriceAtomic: "201" });
  assert.throws(() => validateMetaMaskNativeFeeReceipt(tooMuch, quote));
});

function makeQuote(chainId: MetaMaskNativeFeeChainId): MetaMaskNativeFeeQuote {
  const usdc = directEvmListRows(chainId).filter((row) => row.kind === "token" && row.symbol === "USDC" && row.decimals === 6);
  assert.equal(usdc.length, 1);
  const token = getAddress(usdc[0]!.identifier!);
  const gasLimitAtomic = "65000";
  const maxFeePerGasAtomic = "200";
  const execution = BigInt(gasLimitAtomic) * BigInt(maxFeePerGasAtomic);
  const l1 = chainId === 10 ? 1000n : 0n;
  const operator = chainId === 10 ? 200n : 0n;
  const feeQuote: EvmFeeQuote = {
    chainId,
    ...(chainId === 143 ? { feeModel: "monad-gas-limit" as const } : {}),
    l1DataFeeUpperWei: l1.toString(),
    operatorFeeUpperWei: operator.toString(),
    maximumExecutionFeeWei: execution.toString(),
    totalQuoteWei: (execution + l1 + operator).toString(),
    totalFeeEnforcedOnchain: false,
    blockNumberAtomic: "100",
    blockHash: `0x${"a".repeat(64)}` as Hex,
    rpcOrigin: ORIGIN,
    observedAt: "2026-10-10T00:00:00.000Z",
  };
  const body = {
    schemaVersion: METAMASK_NATIVE_FEE_QUOTE_SCHEMA,
    chainId,
    sender: SENDER,
    token,
    tokenDecimals: 6 as const,
    seller: METAMASK_NATIVE_FEE_SELLER,
    grossAtomic: METAMASK_NATIVE_FEE_AMOUNT_ATOMIC,
    netAtomic: METAMASK_NATIVE_FEE_AMOUNT_ATOMIC,
    tokenFeeAtomic: "0" as const,
    nativeFeeCapAtomic: (execution + l1 + operator + 1n).toString(),
    transaction: {
      type: 2 as const,
      to: token,
      data: encodeFunctionData({ abi: ABI, functionName: "transfer", args: [getAddress(METAMASK_NATIVE_FEE_SELLER), 1000n] }),
      valueAtomic: "0" as const,
      nonceAtomic: "7",
      gasLimitAtomic,
      maxFeePerGasAtomic,
      maxPriorityFeePerGasAtomic: "2",
      authorizationList: [] as const,
    },
    feeQuote,
    expiresAt: "2026-10-10T00:01:00.000Z",
  };
  return { ...body, quoteHash: hashObject(body) };
}

function makeReceipt(quote: MetaMaskNativeFeeQuote, overrides: Partial<MetaMaskNativeFeeReceiptEvidence> = {}): MetaMaskNativeFeeReceiptEvidence {
  const safeHead = [143, 1329].includes(quote.chainId)
    ? { numberAtomic: "102", hash: `0x${"c".repeat(64)}` as Hex }
    : undefined;
  const transferLog = {
    address: quote.token,
    topics: [
      TRANSFER_TOPIC,
      `0x${quote.sender.slice(2).toLowerCase().padStart(64, "0")}` as Hex,
      `0x${quote.seller.slice(2).toLowerCase().padStart(64, "0")}` as Hex,
    ],
    data: `0x${BigInt(METAMASK_NATIVE_FEE_AMOUNT_ATOMIC).toString(16).padStart(64, "0")}` as Hex,
  };
  const base: MetaMaskNativeFeeReceiptEvidence = {
    schemaVersion: METAMASK_NATIVE_FEE_RECEIPT_SCHEMA,
    quoteHash: quote.quoteHash,
    transactionHash: `0x${"e".repeat(64)}` as Hex,
    chainId: quote.chainId,
    sender: quote.sender,
    to: quote.transaction.to,
    valueAtomic: "0",
    transactionType: 2,
    nonceAtomic: quote.transaction.nonceAtomic,
    data: quote.transaction.data,
    gasLimitAtomic: quote.transaction.gasLimitAtomic,
    maxFeePerGasAtomic: quote.transaction.maxFeePerGasAtomic,
    maxPriorityFeePerGasAtomic: quote.transaction.maxPriorityFeePerGasAtomic,
    authorizationList: [],
    status: "success",
    gasUsedAtomic: "50000",
    effectiveGasPriceAtomic: "150",
    receiptBlock: { numberAtomic: "101", hash: `0x${"b".repeat(64)}` as Hex },
    canonicalBlock: { numberAtomic: "101", hash: `0x${"b".repeat(64)}` as Hex },
    ...(safeHead === undefined ? {} : { safeHead }),
    logs: [transferLog],
    rpcOrigin: ORIGIN,
    observedAt: "2026-10-10T00:00:40.000Z",
    ...(quote.chainId === 10 ? { opStackFeeComponents: {
      l1DataFeeAtomic: "60", operatorFeeAtomic: "20", receiptExtensionHash: "f".repeat(64),
    } } : {}),
  };
  const result = { ...base, ...overrides };
  return result;
}
