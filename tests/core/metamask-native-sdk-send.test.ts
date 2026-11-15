/**
 * QA 0.5.107 (Sei native cee62de8…): `mm wallet send-transaction` generated the server request id itself and wrote it
 * nowhere before its POST, so a send that exited without printing it left a request nothing could find. From 0.5.108 the
 * native hand-off sends APN's own id (sealed and journaled by the owner before this call) through the sandboxed helper.
 * Here the owner scope is a double; the request builder, the helper client, the helper itself with the vendored SDK and
 * its network policy are real, run in process against a synthetic `~/.metamask` and a synthetic exchange. No HOME,
 * Keychain or network. Nothing here imports helpers.ts: it loads src/core.js before the mocks below could apply.
 */
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { encodeFunctionData, getAddress } from "viem";
import { hashObject, sha256 } from "../../src/canonical.js";
import { directEvmListRows } from "../../src/evm-direct-networks.js";
import { executeHelperRequest } from "../../src/metamask-gasless/client/service.js";
import type { HelperRequest } from "../../src/metamask-gasless/client/protocol.js";
import type { FetchExchange, FetchExchangeRequest, FetchExchangeResponse } from "../../src/metamask-gasless/client/network.js";
import { runnerDiagnostic, submitFailureError } from "../../src/metamask-gasless/client/submit-diagnostic.js";
import type { MetaMaskNativeFeeQuote } from "../../src/metamask-native-fee-evidence.js";
import type { MetaMaskNativeOwnedContext, MetaMaskNativeOwnedScope } from "../../src/metamask-native-transfer-owner.js";
import { OWNER, PROJECT, syntheticHome } from "./metamask-gasless-client-fixtures/sdk.js";

const RID = "8cc50f3c-ca4e-41d1-98bb-b30f7bcaa3aa", TX = `0x${"ab".repeat(32)}`, EXPIRES = "2030-01-01T00:10:00.000Z";
const SENDER = getAddress(OWNER), RECIPIENT = getAddress("0x5555555555555555555555555555555555555555");
const PRIVATE = "private_provider_metadata_canary";
const COLLECTION = `https://agentic-mimir-service.api.cx.metamask.io/v1/projects/${PROJECT}/transaction-requests`;
// Encoded here: a value import of the evidence module would load the real owner before the mocks below.
const transferData = (to: `0x${string}`, amount: string) => encodeFunctionData({ abi: [{ type: "function", name: "transfer", stateMutability: "nonpayable",
  inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] }], functionName: "transfer", args: [to, BigInt(amount)] });

/** MetaMask's answer to the one POST: the job for the posted request with `patch` merged in, or a refusing status. */
class Server implements FetchExchange {
  readonly requests: FetchExchangeRequest[] = [];
  readonly bodies: string[] = [];
  beforeSends = 0;
  constructor(readonly patch: Record<string, unknown> = {}, readonly status = 200, readonly errorBody = "{}") {}
  async request(request: FetchExchangeRequest): Promise<FetchExchangeResponse> {
    this.requests.push(request); request.beforeSend?.(); if (request.beforeSend) this.beforeSends += 1;
    if (this.status !== 200) return { status: this.status, body: this.errorBody };
    const posted = JSON.parse(request.body!) as { requestId: string; tx: unknown };
    const body = JSON.stringify({ requestId: posted.requestId, status: "EVALUATING", tx: posted.tx, txApprovalLink: `https://provider.example/${PRIVATE}`,
      approval: { approvalId: PRIVATE, expiresAt: EXPIRES, violations: [] }, ...this.patch });
    this.bodies.push(body); return { status: 200, body };
  }
}

let allowTransport = false, guards = 0, guardFailure: Error | undefined, runnerFailure: unknown;
let home: Awaited<ReturnType<typeof syntheticHome>> | undefined, server = new Server();
const runs: { readonly request: HelperRequest; readonly timeoutMs: number }[] = [];
mock.module("../../src/metamask-native-transfer-owner.js", { namedExports: {
  claimMetaMaskNativeOwnedScope: () => { if (!allowTransport) throw new Error("TEST unowned"); },
  assertMetaMaskNativeOwnedScope: (_scope: unknown, c: MetaMaskNativeOwnedContext) => ({ utcExpiresAt: c.consentExpiresAt,
    monotonicDeadlineMs: performance.now() + Date.parse(c.consentExpiresAt) - Date.now() }),
  assertMetaMaskNativeOwnedContextCurrent: async () => { guards += 1; if (guardFailure !== undefined) throw guardFailure; },
  metaMaskNativeOwnedRequestId: () => RID,
} });
// The production client, with the subprocess replaced by the same helper run in process.
const realClient = await import("../../src/metamask-gasless/client/process.js");
mock.module("../../src/metamask-gasless/client/process.js", { namedExports: { ...realClient,
  MetaMaskGaslessProviderClient: class extends realClient.MetaMaskGaslessProviderClient {
    constructor() {
      super({ environment: {}, clock: { now: () => new Date() }, runner: { async run(request: HelperRequest, options: { readonly timeoutMs: number }) {
        runs.push({ request, timeoutMs: options.timeoutMs });
        if (runnerFailure !== undefined) throw runnerFailure;
        return await executeHelperRequest(request, { homeDirectory: home!.home, exchange: server });
      } } });
    }
  } } });
const { submitOwnedMetaMaskNative, MetaMaskNativeHandoffNotStarted } = await import("../../src/metamask-native-transfer-adapter.js");

function context(change: { readonly nonceAtomic?: string; readonly projectHash?: string } = {}): MetaMaskNativeOwnedContext {
  const now = new Date(), token = getAddress(directEvmListRows(1).find(r => r.symbol === "USDC" && r.kind === "token")!.identifier!);
  const body = { schemaVersion: "apn.metamask-native-fee-quote.v2" as const, chainId: 1 as const, sender: SENDER, token, tokenDecimals: 6 as const,
    recipient: RECIPIENT, amountAtomic: "2500", nativeFeeCapAtomic: "13000001",
    transaction: { type: 2 as const, to: token, data: transferData(RECIPIENT, "2500"), valueAtomic: "0" as const, nonceAtomic: change.nonceAtomic ?? "7",
      gasLimitAtomic: "65000", maxFeePerGasAtomic: "200", maxPriorityFeePerGasAtomic: "2", authorizationList: [] as const },
    feeQuote: { chainId: 1, l1DataFeeUpperWei: "0", operatorFeeUpperWei: "0", maximumExecutionFeeWei: "13000000", totalQuoteWei: "13000000",
      totalFeeEnforcedOnchain: false, blockNumberAtomic: "100", blockHash: `0x${"b".repeat(64)}` as `0x${string}`, rpcOrigin: "https://rpc.example",
      observedAt: now.toISOString() }, expiresAt: new Date(now.getTime() + 60000).toISOString() };
  const quote = { ...body, quoteHash: hashObject(body) } as MetaMaskNativeFeeQuote;
  return { profile: "qa-mm-wallet", profileHash: "1".repeat(64), accountBindingHash: "2".repeat(64), capabilityHash: "3".repeat(64), profileRevision: 1,
    policyDigest: "4".repeat(64), policyRevision: 1, activationDigest: "5".repeat(64), vendorPolicyHash: "9".repeat(64),
    vendorProjectHash: change.projectHash ?? sha256(PROJECT), quote, operationId: "6".repeat(64),
    consentExpiresAt: new Date(now.getTime() + 60000).toISOString(), issuedDay: now.toISOString().slice(0, 10) };
}
const scope = {} as MetaMaskNativeOwnedScope;
async function setup(t: test.TestContext, patch: Record<string, unknown> = {}, status = 200, errorBody = "{}",
  options: Parameters<typeof syntheticHome>[0] = {}) {
  allowTransport = true; guards = 0; guardFailure = undefined; runnerFailure = undefined; runs.length = 0;
  server = new Server(patch, status, errorBody); home = await syntheticHome(options); t.after(home.cleanup);
}
const sendDiagnostic = (value: unknown) => {
  const { durationMs, remainingMs, ...rest } = value as Record<string, unknown>;
  assert.ok(Number.isSafeInteger(durationMs) && Number.isSafeInteger(remainingMs) && (remainingMs as number) <= 60_000);
  return rest;
};

test("the hand-off sends exactly the request mm 6.1.5 sent for 0.5.107's payload and intent, with APN's own id, once", async (t) => {
  await setup(t);
  const ctx = context(), result = await submitOwnedMetaMaskNative(scope, ctx);
  assert.equal(result.disposition, "pending"); assert.equal("mfa" in result, false);
  assert.deepEqual(sendDiagnostic(result.diagnostic), { stage: "sdk_send", code: "ok", exitCode: 0, signal: null, stderrClass: "none", providerCode: "none" });
  assert.equal(guards, 1, "the owner's last guard runs once, before the send"); assert.equal(runs.length, 1);
  assert.equal(runs[0]!.request.mode, "submitTransaction");
  assert.ok(runs[0]!.timeoutMs > 0 && runs[0]!.timeoutMs <= 60_000, "the helper is killed at the consent deadline");
  assert.equal(server.requests.length, 1); assert.equal(server.beforeSends, 1);
  const [request] = server.requests;
  assert.deepEqual([request!.url, request!.method, request!.headers.authorization], [COLLECTION, "POST", `Bearer ${home!.token}`]);
  // mm parsed `{"to":<token>,"data":…,"value":"0x0","gas":"0xfde8","nonce":"0x7","maxFeePerGas":"0xc8","maxPriorityFeePerGas":"0x2"}`
  // into this tx (lowercase addresses, numeric nonce, gas as gasLimit) and the intent into txIntent; the id was its own.
  assert.equal(request!.body, JSON.stringify({ requestId: RID, namespace: "evm", chainId: 1, tx: { from: OWNER, to: ctx.quote.token.toLowerCase(),
    chainId: 1, data: ctx.quote.transaction.data, value: "0x0", nonce: 7, gasLimit: "0xfde8", maxFeePerGas: "0xc8", maxPriorityFeePerGas: "0x2" },
  txIntent: `APN ${ctx.operationId}: 2500 atomic USDC to ${RECIPIENT}` }));
});

test("AWAITING_MFA is pending with the owner's approval window and the session's auth method, and nothing else of the answer", async (t) => {
  await setup(t, { status: "AWAITING_MFA" });
  const result = await submitOwnedMetaMaskNative(scope, context());
  assert.equal(result.disposition, "pending");
  assert.deepEqual(result.mfa, { expiresAt: EXPIRES, authMethod: "qr", evidenceHash: sha256(server.bodies[0]!) });
  assert.equal(JSON.stringify(result).includes(PRIVATE), false, "no approval id, link or violation leaves the helper");
  await setup(t, { status: "AWAITING_MFA", approval: { expiresAt: "tomorrow" } });
  const loose = await submitOwnedMetaMaskNative(scope, context());
  assert.deepEqual(loose.disposition === "pending" && { ...loose.mfa, evidenceHash: null }, { expiresAt: null, authMethod: "qr", evidenceHash: null },
    "a window not in its exact form is null, never guessed");
});

test("a hash is acknowledged, a closed request and an unknown status stay UNKNOWN; none is a refusal", async (t) => {
  for (const [patch, expected] of [
    [{ status: "BROADCASTED", txHash: TX }, { disposition: "acknowledged", transactionHash: TX }],
    [{ status: "CONFIRMED", txHash: TX }, { disposition: "acknowledged", transactionHash: TX }],
    [{ status: "FAILED", txHash: TX }, { disposition: "unknown", reason: "provider_request_closed", transactionHash: TX }],
    [{ status: "DENIED" }, { disposition: "unknown", reason: "provider_request_closed" }],
    [{ status: "EXPIRED", txHash: null }, { disposition: "unknown", reason: "provider_request_closed" }],
    [{ status: "BROADCAST_TRACKING_EXPIRED" }, { disposition: "unknown", reason: "provider_request_outcome_unknown" }],
    [{ status: "SIGNING" }, { disposition: "pending" }],
  ] as const) {
    await setup(t, patch);
    const { diagnostic, ...result } = await submitOwnedMetaMaskNative(scope, context());
    assert.deepEqual(result, expected, JSON.stringify(patch)); assert.equal(diagnostic?.code, "ok"); assert.equal(server.requests.length, 1);
  }
});

test("every failure once the helper may have started is UNKNOWN with a closed diagnostic, never a refusal before the effect", async (t) => {
  const expectUnknown = async (code: string, providerCode: string, requests: number, reason = "provider_handoff_outcome_unknown") => {
    const result = await submitOwnedMetaMaskNative(scope, context());
    assert.deepEqual({ disposition: result.disposition, reason: result.disposition === "unknown" && result.reason }, { disposition: "unknown", reason });
    assert.deepEqual(sendDiagnostic(result.diagnostic), { stage: "sdk_send", code, exitCode: null, signal: null, stderrClass: "none", providerCode });
    assert.equal(server.requests.length, requests); assert.equal(runs.length, 1);
    assert.equal(JSON.stringify(result).includes(PRIVATE), false);
  };
  await setup(t, {}, 422, JSON.stringify({ error: { code: "POLICY_VIOLATION", message: PRIVATE } })); await expectUnknown("refused", "policy", 1);
  await setup(t, {}, 401); await expectUnknown("refused", "auth", 1);
  await setup(t, {}, 503, JSON.stringify({ error: { code: "UNAVAILABLE" } })); await expectUnknown("refused", "other", 1);
  await setup(t, { requestId: "00000000-0000-4000-8000-000000000099" }); await expectUnknown("protocol", "none", 1, "provider_request_identity_conflict");
  await setup(t, { tx: { from: "0x9999999999999999999999999999999999999999", chainId: 1 } }); await expectUnknown("protocol", "none", 1);
  await setup(t); runnerFailure = submitFailureError("mm_gasless_submit_unknown", runnerDiagnostic("runner_timeout", true)); await expectUnknown("timeout", "none", 0);
  await setup(t); runnerFailure = submitFailureError("mm_gasless_submit_unknown", runnerDiagnostic("runner_exit", true)); await expectUnknown("exit", "none", 0);
  await setup(t); runnerFailure = new Error("TEST the runner failed"); await expectUnknown("start", "none", 0);
  // The helper refuses before any network call, but it had started: the outcome is recorded as unknown all the same.
  await setup(t); allowTransport = true;
  const other = await submitOwnedMetaMaskNative(scope, context({ projectHash: sha256("another-project") }));
  assert.equal(other.disposition, "unknown"); assert.equal(server.requests.length, 0); assert.equal(runs.length, 1);
  const wallet = "0x2222222222222222222222222222222222222222";
  await setup(t, {}, 200, "{}", { ref: { address: wallet }, remoteWallets: [{ address: OWNER, namespace: "evm" }, { address: wallet, namespace: "evm" }] });
  assert.equal((await submitOwnedMetaMaskNative(scope, context())).disposition, "unknown"); assert.equal(server.requests.length, 0);
});

test("every check that can fail runs before the helper: a refused claim, last guard or request never starts it", async (t) => {
  await setup(t); allowTransport = false;
  await assert.rejects(submitOwnedMetaMaskNative(scope, context()), (error: unknown) => error instanceof MetaMaskNativeHandoffNotStarted);
  await setup(t); guardFailure = new Error("TEST the Guard policy changed");
  await assert.rejects(submitOwnedMetaMaskNative(scope, context()), (error: unknown) => error instanceof MetaMaskNativeHandoffNotStarted &&
    error.causeError === guardFailure);
  // mm itself refuses a nonce past a safe integer: the request is built and refused before the guard and the helper.
  await setup(t);
  await assert.rejects(submitOwnedMetaMaskNative(scope, context({ nonceAtomic: "9007199254740992" })),
    (error: unknown) => error instanceof MetaMaskNativeHandoffNotStarted);
  assert.equal(guards, 0); assert.equal(runs.length, 0); assert.equal(server.requests.length, 0);
});
