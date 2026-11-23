/** Destination proof of a Relay token route arriving on BNB Smart Chain: one Transfer of the pinned 18-decimal Binance-Peg
 * USDC to the operation's own recipient at BNB's safe checkpoint. Another token, a 6-decimal reading, an unsafe block, a
 * foreign chain or an ambiguous receipt never proves; a saved operation whose quote no longer binds its route is corrupt. */
import assert from "node:assert/strict";
import test from "node:test";
import { freezeRelayUnsignedOperation, validateRelayUnsignedOperation } from "../../src/relay-unsigned-operation.js";
import { proveRelayTokenDestination, type RelayBnbProofPorts, type RelayBnbReceipt } from "../../src/relay/destination-proof.js";
import { relayErc20SourceLeg, relayErc20UsageIdentity } from "../../src/relay/erc20-source-leg.js";
import { validateRelayTokenQuote } from "../../src/relay/token-quote.js";
import { RELAY_TOKEN_DEPOSITORY } from "../../src/relay/token-routes.js";
import { QA_PAYER, QA_RECIPIENT, QA_TOKEN_CAPTURED_AT, quoteFixture } from "./relay-any-profile-harness.js";

const BNB_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", BNB_USDT = "0x55d398326f99059fF775485246999027B3197955";
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const hash = (digit: string) => `0x${digit.repeat(64)}`;
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const topic = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
const transfer = (token: string, to: string, amount: bigint) =>
  ({ address: token.toLowerCase(), topics: [TRANSFER, topic("0xf70da97812cb96acdf810712aa562db8dfa3dbef"), topic(to)], data: word(amount) });

async function fixture() {
  const quote = await validateRelayTokenQuote(await quoteFixture("arbitrum-usdc-bnb-usdc"), { routeReference: "arbitrum-usdc-bnb-usdc-v1",
    payer: QA_PAYER.toLowerCase(), recipient: QA_RECIPIENT.toLowerCase(), amountAtomic: "5000000", minimumOutputAtomic: "4800000000000000000",
    nowSeconds: QA_TOKEN_CAPTURED_AT });
  const fields = { schemaVersion: "apn.relay-unsigned-operation.v1" as const, kind: "relay_unsigned" as const, state: "prepared" as const,
    terminal: false as const, profileHash: "1".repeat(64), operationId: "2".repeat(64), idempotencyHash: "3".repeat(64),
    requestHash: "4".repeat(64), sourceChainId: 42161 as const, destinationChainId: 56 as const, sourceAccount: QA_PAYER.toLowerCase(),
    recipient: QA_RECIPIENT.toLowerCase(), quoteDigest: quote.quoteDigest, tokenQuote: quote, statusLocator: quote.statusLocator,
    policyDigest: "5".repeat(64), policyRevision: 1, approvalNetworkFeeCeilingWei: quote.approval.maximumNetworkFeeWei,
    depositNetworkFeeCeilingWei: quote.deposit.maximumNetworkFeeWei, amountAtomic: "5000000", minOutputAtomic: quote.minimumOutputAtomic,
    createdAt: new Date(QA_TOKEN_CAPTURED_AT * 1000).toISOString(), deadline: new Date(quote.deadline * 1000).toISOString() };
  const op = freezeRelayUnsignedOperation(fields);
  const minimum = BigInt(op.minOutputAtomic), destHash = hash("c"), blockHash = hash("d"), safeHash = hash("e");
  const receipt = (logs: NonNullable<RelayBnbReceipt["logs"]>): RelayBnbReceipt =>
    ({ transactionHash: destHash, status: "success", blockNumber: 200n, blockHash, logs });
  const ports = (logs: NonNullable<RelayBnbReceipt["logs"]>, overrides: Partial<RelayBnbProofPorts> = {}): RelayBnbProofPorts => ({
    chainId: async () => 56,
    transaction: async () => ({ hash: destHash, chainId: 56, to: BNB_USDC.toLowerCase(), valueWei: 0n, blockNumber: 200n, blockHash }),
    receipt: async () => receipt(logs), block: async number => ({ number, hash: number === 200n ? blockHash : safeHash }),
    finalityCheckpoint: async () => ({ number: 205n, hash: safeHash }), ...overrides });
  return { op, fields, quote, minimum, destHash, safeHash, ports };
}

test("an 18-decimal Binance-Peg USDC Transfer to the recipient at BNB safe proves the token-route credit", async () => {
  const f = await fixture();
  assert.equal(f.minimum, 4866951460000000000n, "the signed order's minimum is 18-decimal BNB USDC");
  const result = await proveRelayTokenDestination(f.op, hash("a"), [f.destHash], f.ports([transfer(BNB_USDC, QA_RECIPIENT, f.minimum)]));
  assert.equal(result.status, "recipient_credit_proven", JSON.stringify(result));
  assert.deepEqual([result.relayOrderFulfillmentProven, result.paidAcceptance], [false, false]);
  if (result.status === "recipient_credit_proven") {
    assert.deepEqual([result.proof.method, result.proof.creditedWei, result.proof.recipient, result.proof.orderId, result.proof.sourceDepositHash],
      ["pinned_erc20_transfer_event", f.minimum.toString(), QA_RECIPIENT.toLowerCase(), f.quote.orderId, hash("a")]);
    assert.deepEqual([result.proof.finalityBlockNumber, result.proof.finalityBlockHash], ["205", f.safeHash]);
  }
});

test("another token, a 6-decimal amount, two transfers, an unsafe block or another chain never proves", async () => {
  const f = await fixture();
  const prove = (ports: RelayBnbProofPorts) => proveRelayTokenDestination(f.op, hash("a"), [f.destHash], ports);
  const cases: Array<[string, RelayBnbProofPorts, string, string]> = [
    ["BNB USDT instead of USDC", f.ports([transfer(BNB_USDT, QA_RECIPIENT, f.minimum)]), "unproven", "token_credit_missing_or_ambiguous"],
    ["the minimum read in 6 decimals", f.ports([transfer(BNB_USDC, QA_RECIPIENT, f.minimum / 10n ** 12n)]), "mismatch", "destination_value_below_minimum"],
    ["another recipient", f.ports([transfer(BNB_USDC, QA_PAYER, f.minimum)]), "unproven", "token_credit_missing_or_ambiguous"],
    ["two credits", f.ports([transfer(BNB_USDC, QA_RECIPIENT, f.minimum), transfer(BNB_USDC, QA_RECIPIENT, f.minimum)]), "unproven", "token_credit_missing_or_ambiguous"],
    ["not yet safe", f.ports([transfer(BNB_USDC, QA_RECIPIENT, f.minimum)], { finalityCheckpoint: async () => ({ number: 199n, hash: f.safeHash }) }),
      "pending", "destination_not_safe"],
    ["Ethereum RPC", f.ports([transfer(BNB_USDC, QA_RECIPIENT, f.minimum)], { chainId: async () => 1 }), "mismatch", "destination_chain_id"],
    ["reverted", f.ports([transfer(BNB_USDC, QA_RECIPIENT, f.minimum)], { receipt: async () => ({ transactionHash: f.destHash, status: "reverted",
      blockNumber: 200n, blockHash: hash("d"), logs: [transfer(BNB_USDC, QA_RECIPIENT, f.minimum)] }) }), "mismatch", "destination_receipt_failed"],
  ];
  for (const [name, ports, status, reason] of cases) {
    const result = await prove(ports);
    assert.deepEqual([result.status, "reason" in result ? result.reason : null], [status, reason], name);
  }
  assert.equal((await proveRelayTokenDestination(f.op, hash("a"), [f.destHash, hash("f")], f.ports([]))).status, "mismatch");
});

test("the source leg is the Arbitrum USDC route's own: chain, token, depository, zero-allowance approval and usage bucket", async () => {
  const f = await fixture(), leg = relayErc20SourceLeg(f.op);
  assert.deepEqual([leg.chainId, leg.chain, leg.token, leg.depository, leg.zeroAllowanceRequired, leg.destination?.address, leg.destination?.decimals],
    [42161, "eip155:42161", "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", RELAY_TOKEN_DEPOSITORY, true, BNB_USDC, 18]);
  assert.deepEqual(relayErc20UsageIdentity(f.op), { account: QA_PAYER, chain: "eip155:42161",
    asset: { kind: "token", identifier: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" } });
});

test("a saved token-route operation whose chains, decimals or ceilings drift from its quote is corrupt", async () => {
  const f = await fixture();
  assert.doesNotThrow(() => validateRelayUnsignedOperation(f.op));
  const corrupt = (patch: Record<string, unknown>) => assert.throws(() => freezeRelayUnsignedOperation({ ...f.fields, ...patch } as never),
    (error: { code?: string }) => error.code === "APN_STATE_CORRUPT", JSON.stringify(Object.keys(patch)));
  corrupt({ destinationChainId: 8453 });
  corrupt({ sourceChainId: 1 });
  corrupt({ minOutputAtomic: "4866951" });
  corrupt({ approvalNetworkFeeCeilingWei: "1" });
  corrupt({ tokenQuote: { ...structuredClone(f.quote), destinationDecimals: 6 } });
  corrupt({ quote: structuredClone(f.quote) });
});
