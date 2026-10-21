import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { encodeFunctionData, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hashObject, sha256 } from "../../src/canonical.js";
import { sealAssetPolicyRegistry } from "../../src/asset-policy-registry.js";
import { AssetUsageLedger, assetUsageReservationId } from "../../src/asset-usage-ledger.js";
import type { AssetUsageIdentity } from "../../src/asset-usage-ledger-types.js";
import { ApnError } from "../../src/errors.js";
import type { FinalizedChainRead } from "../../src/evm-finalized-proof.js";
import { CIRCLE_SOURCE_PROOF_SCHEMA, CircleSourceProofStore, circleSourceStatus, type CircleSourceProof } from "../../src/lifi/circle-v2-source-proof.js";
import { BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES } from "../../src/lifi/circle-v2-source-receipt.js";
import { NonEvmSourceJournalRepository, type NonEvmSourceJournal } from "../../src/lifi/non-evm-source-journal.js";
import { RelayUnsignedPrepareService, RELAY_ROUTE_REFERENCE } from "../../src/relay/prepare.js";
import { ETHEREUM_DEPOSITORY, ETHEREUM_USDC, validateRelayQuote } from "../../src/relay/quote.js";
import { RelayUnsignedOperationRepository } from "../../src/relay-unsigned-operation.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";

/** QA 0.5.59: a finalized Circle burn stops counting against later days; a deposit-only Relay quote is a classified refusal. */
const ACCOUNT = privateKeyToAccount(`0x${"11".repeat(32)}`), H = (c: string) => c.repeat(64);
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BURN = parseAbi(["function depositForBurnWithHookAndFees(uint256 amount,uint32 destinationDomain,bytes32 mintRecipient,address burnToken,bytes32 destinationCaller,bytes hookData,(bytes signedQuote,address refundAddress) claim) payable"]);
const DATA = encodeFunctionData({ abi: BURN, functionName: "depositForBurnWithHookAndFees", args: [1_000_000n, 5, `0x${"22".repeat(32)}`,
  BASE_USDC, `0x${"00".repeat(32)}`, "0x", { signedQuote: "0x01", refundAddress: ACCOUNT.address }] });
const identity: AssetUsageIdentity = { account: ACCOUNT.address, chain: "eip155:8453", asset: { kind: "token", identifier: BASE_USDC } };
const DAY = 86_400_000, at = (ms: number) => new Date(Date.now() + ms);
const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v1", registryVersion: "qa0559.1",
  publishedAt: "2026-09-17T00:00:00.000Z", effectiveDate: "2026-09-17", chains: [{ chain: "eip155:8453", family: "evm", name: "Base",
    assets: [{ kind: "token", identifier: BASE_USDC, symbol: "USDC", decimals: 6,
      rails: { direct: false, gasless: false, x402: false, bridge: true, swap: false },
      caps: { maximumPerTransferAtomic: "5900000", dailyLimitAtomic: "6000000" } }] }] });

/** A burn of 1 USDC signed, committed and left unknown, as every released version leaves it before its status. */
async function burned(root: string): Promise<NonEvmSourceJournal> {
  const repo = new NonEvmSourceJournalRepository(root), owner = "95eqQDmQG7y8gad3yReqXqzyFoiQ4LYD9iAY1PMtuyRj";
  let j = await repo.stageLiveCircle({ profileHash: H("a"), operationId: H("b"), draftIntegrityHash: H("c"), route: "base_usdc_to_solana_usdc_circle_cctp_v2",
    createdAt: at(0).toISOString(), maxSourceNativeDebitWei: "1000000000000000",
    sourceCall: { chainId: 8453, from: ACCOUNT.address, to: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES, valueAtomic: "0", data: DATA,
      dataSha256: sha256(Buffer.from(DATA.slice(2), "hex")), type: "eip1559", nonceAtomic: "7", gasLimitAtomic: "100000",
      maxFeePerGasAtomic: "1000000000", maxPriorityFeePerGasAtomic: "1000000", accessList: [] },
    admissionProof: { kind: "circle_v2_live_transport_v1", circleOrigin: "https://iris-api.circle.com", rpcOrigin: "https://base.example.org",
      quoteHash: H("d"), validationHash: H("d"), sourceBlockHash: `0x${H("9")}`, preparationDigest: H("8"), payer: ACCOUNT.address,
      recipientOwner: owner, recipientAta: owner, feeTotalAtomic: "20000" }, protocolInputHash: H("1") });
  const raw = await ACCOUNT.signTransaction({ chainId: 8453, to: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES, data: DATA, value: 0n, nonce: 7,
    gas: 100000n, maxFeePerGas: 1000000000n, maxPriorityFeePerGas: 1000000n, type: "eip1559" });
  j = await repo.signingStarted(j.profileHash, j.operationId, j.integrityHash, at(1).toISOString());
  j = await repo.seal(j.profileHash, j.operationId, j.integrityHash, raw, "7", at(2).toISOString());
  j = await repo.committingSubmission(j.profileHash, j.operationId, j.integrityHash, at(3).toISOString());
  return await repo.observeUnknown(j.profileHash, j.operationId, j.integrityHash, "response_lost", at(4).toISOString());
}
/** The hold the source service took before signing and moved to `submitted` after its one send, `daysAgo` days back. */
async function hold(root: string, daysAgo: number, amountAtomic = "1000000") {
  const ledger = new AssetUsageLedger(root), key = `circle-v2-base-source:${H("b")}`;
  const reserved = await ledger.reserve({ ...identity, registry, rail: "bridge", amountAtomic, idempotencyKey: key, now: at(-daysAgo * DAY - 60_000) });
  await ledger.transition({ ...identity, reservationId: assetUsageReservationId(identity, key), policyDigest: reserved.policyDigest,
    state: "submitted", expectedCurrentStates: ["reserved"], now: at(-daysAgo * DAY) });
  return { ledger, reservationId: assetUsageReservationId(identity, key) };
}
/** A proof recorded by an earlier status (0.5.59 recorded it and left the hold open). */
async function recorded(root: string, journal: NonEvmSourceJournal, status: "success" | "reverted", observedAt: Date): Promise<CircleSourceProof> {
  const fields = { schemaVersion: CIRCLE_SOURCE_PROOF_SCHEMA as typeof CIRCLE_SOURCE_PROOF_SCHEMA, operationId: journal.operationId, profileHash: journal.profileHash, chainId: 8453 as const,
    payer: journal.sourceCall.from, to: journal.sourceCall.to, transactionHash: journal.transactionHash!, nonceAtomic: journal.nonceAtomic!, status,
    blockNumberAtomic: "100", blockHash: `0x${H("e")}`, blockTag: "finalized" as const, finalizedBlockNumberAtomic: "100", observedAt: observedAt.toISOString() };
  return await new CircleSourceProofStore(root).create(journal, { ...fields, integrityHash: hashObject(fields) });
}
/** Base at the finalized tag; only the residual allowance read (or a first receipt) reaches it. */
function base(receipt: Record<string, unknown> | null = null): (chainId: number) => FinalizedChainRead {
  const rpc: FinalizedChainRead = { async call(method) {
    if (method === "eth_chainId") return "0x2105";
    if (method === "eth_getTransactionReceipt") return receipt;
    if (method === "eth_getBlockByNumber") return { number: "0x64", hash: `0x${H("f")}` };
    if (method === "eth_call") return `0x${"0".repeat(64)}`;
    throw new Error(`unexpected ${method}`);
  } };
  return () => rpc;
}
const usage = async (ledger: AssetUsageLedger, when: Date) => (await ledger.usageReadOnly(identity, when)).amountAtomic;

test("a burn proven final yesterday stops counting today: the next status settles it on its proof day, once", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const journal = await burned(temporary.root), { ledger, reservationId } = await hold(temporary.root, 1);
  const proof = await recorded(temporary.root, journal, "success", at(-DAY + 60_000));
  assert.equal(await usage(ledger, at(0)), "1000000", "0.5.59: the open hold still counts on every later day");
  const view = await circleSourceStatus(temporary.root, journal, base(), () => Date.now());
  assert.deepEqual(view.sourceUsage, { reservationId, state: "finalized", amountAtomic: "1000000", effectAt: proof.observedAt });
  assert.deepEqual([await usage(ledger, at(0)), await usage(ledger, at(-DAY + 120_000))], ["0", "1000000"]);
  const settled = await ledger.load(identity, reservationId);
  assert.equal(settled?.outcomeDigest, hashObject({ kind: "circle_v2_base_source_finalized_receipt", operationId: H("b"), proofIntegrityHash: proof.integrityHash }));
  const again = await circleSourceStatus(temporary.root, journal, base(), () => Date.now());
  assert.deepEqual([again.sourceUsage, (await ledger.load(identity, reservationId))?.reservationDigest], [view.sourceUsage, settled?.reservationDigest]);
});

test("the status that records the receipt settles the hold in the same call; a reverted burn releases it", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const journal = await burned(temporary.root), { ledger } = await hold(temporary.root, 0);
  const receipt = { transactionHash: journal.transactionHash, from: ACCOUNT.address.toLowerCase(), to: BASE_CCTP_V2_TOKEN_MESSENGER_WITH_FEES.toLowerCase(),
    blockNumber: "0x64", blockHash: `0x${H("e")}`, status: "0x1" };
  const view = await circleSourceStatus(temporary.root, journal, base(receipt), () => Date.now());
  assert.deepEqual([view.sourceProof?.status, view.sourceUsage?.state, view.sourceUsage?.effectAt], ["success", "finalized", view.sourceProof?.observedAt]);
  assert.equal(await usage(ledger, at(0)), "1000000", "a spend proven today counts today");
  assert.equal(await usage(ledger, at(DAY)), "0");
  const reverted = await temporaryState(); t.after(reverted.cleanup);
  const failed = await burned(reverted.root), held = await hold(reverted.root, 1);
  await recorded(reverted.root, failed, "reverted", at(-DAY + 60_000));
  const released = await circleSourceStatus(reverted.root, failed, base(), () => Date.now());
  assert.deepEqual([released.sourceUsage?.state, released.sourceUsage?.effectAt], ["failed_confirmed_revert", null]);
  assert.deepEqual([await usage(held.ledger, at(0)), await usage(held.ledger, at(-DAY + 120_000))], ["0", "0"]);
});

test("without a recorded receipt, or for a hold of another principal, the hold stays open", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const journal = await burned(temporary.root), { ledger, reservationId } = await hold(temporary.root, 1);
  const waiting = await circleSourceStatus(temporary.root, journal, base(null), () => Date.now());
  assert.deepEqual([waiting.sourceProof, waiting.sourceUsage, await usage(ledger, at(0))], [null, undefined, "1000000"]);
  const other = await temporaryState(); t.after(other.cleanup);
  const mismatch = await burned(other.root), wrong = await hold(other.root, 1, "999999");
  await recorded(other.root, mismatch, "success", at(-DAY + 60_000));
  const kept = await circleSourceStatus(other.root, mismatch, base(), () => Date.now());
  assert.deepEqual([kept.sourceUsage?.state, await usage(wrong.ledger, at(0))], ["submitted", "999999"]);
  assert.equal((await ledger.load(identity, reservationId))?.state, "submitted");
});

test("two statuses of one recorded burn settle its hold once and both answer", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const journal = await burned(temporary.root), { ledger, reservationId } = await hold(temporary.root, 1);
  await recorded(temporary.root, journal, "success", at(-DAY + 60_000));
  const views = await Promise.all([1, 2, 3].map(() => circleSourceStatus(temporary.root, journal, base(), () => Date.now())));
  assert.deepEqual(views.map(view => view.sourceUsage?.state), ["finalized", "finalized", "finalized"]);
  assert.deepEqual([(await ledger.load(identity, reservationId))?.state, await usage(ledger, at(0))], ["finalized", "0"]);
});

test("a proven effect time is only for a finalized spend and is kept between the hold's last write and this one", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const { ledger, reservationId } = await hold(temporary.root, 1), current = await ledger.load(identity, reservationId);
  const step = { ...identity, reservationId, policyDigest: current!.policyDigest, now: at(0), outcomeDigest: H("5") };
  await assert.rejects(ledger.transition({ ...step, state: "failed_confirmed_revert", effectAt: at(-DAY).toISOString() }), { code: "APN_INVALID_INPUT" });
  const early = await ledger.transition({ ...step, state: "finalized", effectAt: at(-3 * DAY).toISOString() });
  assert.equal(early.effectAt, current!.updatedAt, "never before the hold's own submitted stamp");
  const late = await hold((await temporaryState().then(s => { t.after(s.cleanup); return s; })).root, 0);
  const lateHold = await late.ledger.load(identity, late.reservationId);
  const future = await late.ledger.transition({ ...identity, reservationId: late.reservationId, policyDigest: lateHold!.policyDigest,
    now: at(1_000), outcomeDigest: H("5"), state: "finalized", effectAt: at(DAY).toISOString() });
  assert.equal(future.effectAt, future.updatedAt, "never after the write");
});

const payer = "0x0B4Dd0C3dA001Fa146EEd3f80B01860BEF6B8a14", recipient = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7";
const relayIntent = { payer, recipient, amountAtomic: "2500000", minimumOutputWei: "3000000000000000", nowSeconds: 1790800000 };
const quoteFixture = async (): Promise<any> => JSON.parse(await readFile("tests/core/relay-fixtures/ethereum-usdc-bnb-quote-20260925.json", "utf8"));
const depositOnly = async () => { const q = await quoteFixture(); q.steps = [q.steps[1]]; return q; };

test("a deposit-only Relay quote (the allowance already covers the amount) is a classified refusal, not APN_INTERNAL", async () => {
  await assert.rejects(validateRelayQuote(await depositOnly(), relayIntent), (error: unknown) => error instanceof ApnError &&
    error.code === "APN_OPERATION_BLOCKED" && JSON.stringify(error.details) === JSON.stringify({ reason: "relay_existing_allowance",
      chain: "eip155:1", asset: ETHEREUM_USDC, spender: ETHEREUM_DEPOSITORY }));
  const approvalOnly = await quoteFixture(); approvalOnly.steps = [approvalOnly.steps[0]];
  await assert.rejects(validateRelayQuote(approvalOnly, relayIntent), (error: unknown) => !(error instanceof ApnError) &&
    error instanceof Error && error.message === "Relay quote rejected: unsupported steps");
});

test("Relay prepare names the allowance read and revoke for its own profile and writes nothing; the same command then prepares", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const state = new StateStore(temporary.root); await state.initialize();
  const policy = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2", registryVersion: "test.1",
    publishedAt: "2026-09-29T00:00:00.000Z", effectiveDate: "2026-09-29", effectiveAt: "2026-09-29T00:00:00.000Z",
    expiresAt: "2026-10-02T00:00:00.000Z", chains: [{ chain: "eip155:1", family: "evm", name: "Ethereum", assets: [{ kind: "token",
      identifier: ETHEREUM_USDC, symbol: "USDC", decimals: 6, rails: { direct: false, gasless: false, x402: false, bridge: true, swap: false },
      railCaps: { bridge: { maximumPerTransferAtomic: "3000000", dailyLimitAtomic: "5000000" } },
      mechanismPins: { bridge: { provider: "relay", reference: RELAY_ROUTE_REFERENCE } } }] }] });
  let quote = depositOnly;
  const service = new RelayUnsignedPrepareService(state, { now: () => new Date(1790800000 * 1000) }, undefined, {
    activePolicy: async () => ({ profile: "default", registry: policy, digest: policy.policyDigest, revision: 1, accounts: { evm: payer },
      activationDigest: "a".repeat(64), activatedAt: "2026-09-30T00:00:00.000Z" }),
    publicAccount: async () => payer, dailyUsage: async () => "0",
    quote: async intent => await validateRelayQuote(await quote(), intent) });
  const input = { profile: "default", recipient, amountAtomic: "2500000", minOutputAtomic: "3000000000000000",
    maxApprovalNetworkFeeWei: "30000000000000", maxDepositNetworkFeeWei: "30000000000000", idempotencyKey: "relay-qa0559-0001" };
  const target = `--profile default --chain eip155:1 --asset ${ETHEREUM_USDC} --spender ${ETHEREUM_DEPOSITORY}`;
  await assert.rejects(service.prepare(input), (error: unknown) => error instanceof ApnError && error.code === "APN_OPERATION_BLOCKED" &&
    JSON.stringify(error.details?.nextActions) === JSON.stringify([`apn wallet allowance status ${target}`,
      `apn wallet allowance revoke ${target} --max-gas-limit <gas-limit> --max-fee-per-gas-wei <wei> --max-priority-fee-per-gas-wei <wei>`,
      "After the revoke is final, rerun the same apn relay prepare command."]));
  const operationId = state.operationId("default", input.idempotencyKey);
  assert.equal(await new RelayUnsignedOperationRepository(temporary.root).loadOperation(state.profileHash("default"), operationId), null);
  quote = quoteFixture;
  assert.equal((await service.prepare(input)).operationId, operationId);
});
