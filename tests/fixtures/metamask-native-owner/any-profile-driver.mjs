// TEST ONLY. The real CLI path (`runCli`: argv binding, core dispatch, owner, the real vendor adapter and process runner,
// the real RPC module and EvmRpc, journal and usage ledger) for a profile that is not the owner's, with its own recipient
// and amount. Only the edges are synthetic: a fake `mm` child script for the reads, a double of the sandboxed helper's one
// send and of its server read (0.5.108), an in-memory JSON-RPC chain and a synthetic wrapping secret that seals the
// MetaMask request id APN names (QA F26). No HOME, Keychain, network or money. Runs in a pseudo-terminal so the real
// foreground consent prompt is answered.
import { mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const base = pathToFileURL(process.argv[2] + "/");
const moduleUrl = (name) => new URL(name, base).href;
const scenario = process.argv[3] ?? "positive";
const { getAddress, encodeFunctionData } = await import("viem");

const PAYER = getAddress("0x4444444444444444444444444444444444444444");
const RECIPIENT = getAddress("0x5555555555555555555555555555555555555555");
const PINNED = getAddress("0x6666666666666666666666666666666666666666");
const PROFILE = "qa-mm-wallet", AMOUNT = "2500", USDC = getAddress("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48");
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const temp = await realpath(await mkdtemp(join(tmpdir(), "apn-mm-any-TEST-")));
const script = join(temp, "mm.cjs"), log = join(temp, "children.jsonl");
// Scenario "mfa": the next helper send, watch and server read answers, written by the driver before each command (the
// watch in exact 6.1.5 output bytes).
const sendAnswer = join(temp, "send.json"), watchAnswer = join(temp, "watch.json"), serverAnswer = join(temp, "server.json");
let root = join(temp, "home");

// The vendor's Guard policy for this user: their own wallet, their own recipients, other sections the reader ignores.
const allowed = scenario === "guard-refused" ? [] : [RECIPIENT, PINNED];
const vendorPolicy = ["# Mimir Wallet Policy", "schema_version: 1", `wallet_address: "${PAYER.toLowerCase()}"`, "", "addresses:", "  allowlist:",
  ...allowed.flatMap((address) => [`    - address: "${address.toLowerCase()}"`, "      chain_id: 1"]),
  "    - address: \"0x7777777777777777777777777777777777777777\"", "      chain_id: 8453", "  blocklist: []", "",
  "protocols:", "  allowlist:", "    - name: \"uniswap\" # not read by APN", "", "evm:", "  allowed_chains:", "    - 1", "    - 8453",
  "  outflow_limits_usd:", "    rolling_24h: 10", ""].join("\n");
await writeFile(script, `const fs=require("node:fs"),crypto=require("node:crypto");const a=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+"\\n");
const payer=${JSON.stringify(PAYER.toLowerCase())},project="TEST-any-profile-project";let data;
if(a[0]==="auth")data={authenticated:true,summary:{mode:"session",projectId:project}};
else if(a[1]==="trading-mode")data={mode:"guard",address:payer};
else if(a[1]==="policy")data={address:payer,policy:${JSON.stringify(vendorPolicy)}};
else if(a[1]==="requests"&&a[2]==="watch")data=JSON.parse(fs.readFileSync(${JSON.stringify(watchAnswer)},"utf8"));
else throw new Error("TEST unexpected vendor argv");
if(typeof data.stdout==="string"){process.stdout.write(data.stdout);process.exitCode=data.exit;}
else process.stdout.write(JSON.stringify({ok:true,data}));`, { mode: 0o600 });
const originalPackage = await import(moduleUrl("metamask-package.js"));
await mock.module(moduleUrl("metamask-package.js"), { namedExports: { ...originalPackage, resolveMetaMaskBin: async () => script } });
// 0.5.108: the hand-off is the sandboxed helper's one POST, never an mm child. The double records the request in the child
// log (reads and the send keep their order) and answers as MetaMask would: from `send.json` when the scenario wrote one,
// else with a broadcast whose hash is the SHA-256 of the request's tx. A request APN sent itself is read from MetaMask's
// server by its id (`server.json`), never watched through mm.
let lastRequestId;
const realSend = await import(moduleUrl("metamask-server-transaction.js"));
await mock.module(moduleUrl("metamask-server-transaction.js"), { namedExports: { ...realSend, sendMetaMaskServerTransaction: async (transaction, timeoutMs) => {
  const { appendFile } = await import("node:fs/promises"), { createHash: digest } = await import("node:crypto");
  const tx = JSON.stringify(transaction.tx);
  await appendFile(log, `${JSON.stringify(["sdk-helper", "send-transaction", tx, JSON.stringify(transaction)])}\n`);
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60_000, "the helper is killed at the consent deadline");
  lastRequestId = transaction.requestId;
  const written = await readFile(sendAnswer, "utf8").then(JSON.parse, () => null);
  const answer = written ?? { status: "BROADCASTED", txHash: `0x${digest("sha256").update(tx).digest("hex")}`, mfa: null };
  return { kind: "answered", answer: { requestId: transaction.requestId, responseHash: "4".repeat(64), ...answer } };
} } });
const realServerRead = await import(moduleUrl("metamask-native-request-server-read.js"));
await mock.module(moduleUrl("metamask-native-request-server-read.js"), { namedExports: { ...realServerRead,
  readMetaMaskNativeServerRequest: async (requestId, _projectHash, binding) => {
    const { appendFile } = await import("node:fs/promises");
    await appendFile(log, `${JSON.stringify(["sdk-helper", "read-request", requestId])}\n`);
    assert.equal(binding.sender, PAYER); assert.equal(binding.chainId, 1);
    return JSON.parse(await readFile(serverAnswer, "utf8"));
  } } });

// In-memory chain: answers by phase (prepare, guard before the hand-off, observe after it) and counts every RPC call.
const counts = { prepare: 0, guard: 0, observe: 0 };
const children = async () => (await readFile(log, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const sends = async () => (await children()).filter((argv) => argv[1] === "send-transaction").map((argv) => argv[2]);
const word = (value) => `0x${BigInt(value).toString(16).padStart(64, "0")}`;
const { createHash } = await import("node:crypto");
async function chain(method, params) {
  const sent = await sends(), policies = (await children()).filter((argv) => argv[1] === "policy").length;
  counts[sent.length > 0 && policies === 2 * sent.length ? "observe" : policies % 2 === 0 ? "guard" : "prepare"] += 1;
  const head = 0x66 + 2 * sent.length;
  const mined = new Map(sent.map((payload, index) => [`0x${createHash("sha256").update(payload).digest("hex")}`, { payload: JSON.parse(payload), block: 0x67 + 2 * index }]));
  switch (method) {
    case "eth_chainId": return "0x1";
    case "eth_getTransactionCount": return `0x${(7 + sent.length).toString(16)}`;
    case "eth_estimateGas": return "0xfde8";
    case "eth_maxPriorityFeePerGas": return "0x1";
    case "eth_getBlockByNumber": {
      const number = params[0] === "latest" || params[0] === "safe" ? head : Number(params[0]);
      return { number: `0x${number.toString(16)}`, hash: `0x${number.toString(16).padStart(64, "b")}`, baseFeePerGas: "0x1" };
    }
    case "eth_getBalance": return `0x${(10n ** 18n).toString(16)}`;
    case "eth_getCode": return "0x6080";
    case "eth_call": if (params[0].data === "0x313ce567") return word(6); if (params[0].data.startsWith("0x70a08231")) return word(1_000_000); break;
    case "eth_getTransactionReceipt": case "eth_getTransactionByHash": {
      const tx = mined.get(params[0]);
      if (tx === undefined) return null;
      const tag = `0x${tx.block.toString(16)}`, blockHash = `0x${tx.block.toString(16).padStart(64, "b")}`, p = tx.payload;
      if (method === "eth_getTransactionByHash") return { hash: params[0], chainId: "0x1", blockHash, blockNumber: tag, from: PAYER.toLowerCase(), to: getAddress(p.to),
        type: "0x2", value: "0x0", nonce: `0x${p.nonce.toString(16)}`, gas: p.gasLimit, maxFeePerGas: p.maxFeePerGas, maxPriorityFeePerGas: p.maxPriorityFeePerGas, input: p.data };
      const to = `0x${p.data.slice(34, 74)}`, amount = BigInt(`0x${p.data.slice(74, 138)}`);
      return { transactionHash: params[0], blockHash, blockNumber: tag, status: "0x1", gasUsed: "0xc350", effectiveGasPrice: "0x2", logs: [{
        address: getAddress(p.to), topics: [TRANSFER_TOPIC, word(PAYER), word(to)], data: word(amount), transactionHash: params[0], blockHash, blockNumber: tag, removed: false }] };
    }
  }
  throw new Error(`TEST unexpected RPC ${method}`);
}
const actualRpc = await import(moduleUrl("rpc.js"));
const { EvmRpc } = await import(moduleUrl("evm-rpc.js"));
await mock.module(moduleUrl("rpc.js"), { namedExports: { ...actualRpc, HttpsBaseRpc: class {
  constructor(endpoint) { this.rpcOrigin = new URL(endpoint).origin; this.evm = new EvmRpc(chain, this.rpcOrigin); }
} } });
process.env.APN_ETHEREUM_RPC_URL = "https://ethereum.rpc.test.example";

const { runCli } = await import(moduleUrl("cli.js"));
const { StateStore } = await import(moduleUrl("state.js"));
const { AllowlistPolicyStore } = await import(moduleUrl("allowlist-policy-store.js"));
const { metamaskDirectCapabilitySnapshot, capabilityHash, accountBindingHash } = await import(moduleUrl("provider-profile.js"));
const { AssetUsageLedger } = await import(moduleUrl("asset-usage-ledger.js"));
const { OperationService } = await import(moduleUrl("operation-service.js"));
const testWrapping = { load: async () => Buffer.alloc(32, 7), create: async () => Buffer.alloc(32, 7) };
const cli = (argv) => runCli(argv, process.env, { stateRoot: root, wrappingSecret: testWrapping });
const transfer = (recipient, amount, key) => cli(["wallet", "metamask", "native-transfer", "--profile", PROFILE, "--chain", "ethereum",
  "--recipient", recipient, "--amount-atomic", amount, "--idempotency-key", key]);
const usage = async (asset) => (await new AssetUsageLedger(root).usage({ account: PAYER, chain: "eip155:1", asset }, new Date())).amountAtomic;
const NATIVE = { kind: "native", identifier: null }, TOKEN = { kind: "token", identifier: USDC };

/**
 * A Guard that needs the owner's approval. The helper's send answers AWAITING_MFA with the approval window and the session's
 * auth method (0.5.108). The watch bytes of a record an earlier release wrote are 6.1.5's own: `requests watch` before
 * approval writes the notice alone (its `_error` goes to stderr, exit 1).
 */
async function mfaScenario() {
  const { canonicalJson, hashObject } = await import(moduleUrl("canonical.js"));
  const { createMcpServer } = await import(moduleUrl("mcp-server.js"));
  const { Client, InMemoryTransport } = await import("@modelcontextprotocol/client");
  const sha = (text) => createHash("sha256").update(text).digest("hex");
  const notice = (pollingId, expiresAt, source) => JSON.stringify({ _notice: { kind: "AWAITING_MFA", ...(source === undefined ? {} : { source }), pollingId, expiresAt,
    authMethod: "social", message: `Approval required: check the email registered to your dashboard and confirm to proceed.\nRequest ID: ${pollingId}` } });
  const sent = (expiresAt) => ({ status: "AWAITING_MFA", txHash: null, mfa: { expiresAt, authMethod: "social" } });
  const answer = async (path, value) => await writeFile(path, JSON.stringify(value));
  const observeCli = (id) => cli(["wallet", "metamask", "native-transfer-observe", "--operation", id]);
  const later = new Date(Date.now() + 600_000).toISOString();
  await answer(sendAnswer, sent(later));
  const first = await transfer(RECIPIENT, AMOUNT, "qa-native-mfa-0001");
  assert.equal(first.ok, true, JSON.stringify(first.error));
  // The request id is APN's own v4 UUID: the helper sent it and the journal names it only by its hash.
  const RID = lastRequestId;
  assert.match(RID, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  const id = first.data.operation_id, observe = `apn wallet metamask native-transfer-observe --operation ${id}`, task = first.data.mfa_task;
  assert.equal(first.data.state, "unknown"); assert.equal(first.data.transaction_hash, null); assert.equal(first.data.effect_attempts, 1);
  // QA F26: the journal and every output keep only the request id's hash; the id itself is sealed apart.
  const { metaMaskNativeRequestIdHash } = await import(moduleUrl("metamask-native-journal.js"));
  assert.deepEqual([task.status, task.request_id_hash, task.auth_method, task.expires_at, task.source, task.observe_command],
    ["awaiting_owner", metaMaskNativeRequestIdHash(RID), "social", later, "send", observe]);
  assert.equal("request_id" in task, false); assert.equal(JSON.stringify(first).includes(RID), false);
  assert.match(task.owner_action, new RegExp(`^Approve the MetaMask request of APN ${id} from the email registered to your MetaMask dashboard`, "u"));
  assert.deepEqual(first.next_actions, [observe]);
  const journalPath = join(root, "metamask-native-operations", `${id}.json`), sealedText = await readFile(journalPath, "utf8");
  assert.equal(sealedText.includes(RID), false); assert.equal(JSON.parse(sealedText).providerRequestIdHash, metaMaskNativeRequestIdHash(RID));
  assert.equal(JSON.parse(sealedText).handoffPath, "sdk_helper");
  // The record 0.5.52 wrote for the captured transfer: UNKNOWN with its request id in plaintext, no task and no helper
  // path (mm sent it). It recovers through the normal observer, unchanged: watched through mm first.
  const { recordHash: _hash, mfaTask: _task, providerRequestIdHash: _sealed, handoffPath: _path, ...sealedBody } = JSON.parse(sealedText);
  const body = { ...sealedBody, providerRequestId: RID };
  await writeFile(journalPath, `${canonicalJson({ ...body, recordHash: hashObject(body) })}\n`);
  const old = await cli(["wallet", "metamask", "native-transfer-status", "--operation", id]);
  assert.equal(old.ok, true, JSON.stringify(old.error)); assert.equal(old.data.mfa_task, undefined); assert.deepEqual(old.next_actions, [observe]);
  const watched = `${notice(RID, later)}\n`;
  await answer(watchAnswer, { stdout: watched, exit: 1 });
  const pending = await observeCli(id);
  assert.equal(pending.ok, true, JSON.stringify(pending.error)); assert.equal(pending.data.state, "unknown"); assert.equal(pending.data.transaction_hash, null);
  const read = pending.data.read_observation;
  assert.deepEqual([read.stage, read.provider_status, read.reason, read.response_hash], ["complete", "AWAITING_MFA", null, sha(watched)]);
  assert.deepEqual([pending.data.mfa_task.source, pending.data.mfa_task.evidence_hash, pending.data.mfa_task.status], ["watch", sha(watched), "awaiting_owner"]);
  assert.deepEqual(pending.next_actions, [observe]);
  // CLI and MCP name the same task and the same no-send observer.
  const server = createMcpServer({ stateRoot: root, wrappingSecret: testWrapping }), [x, y] = InMemoryTransport.createLinkedPair();
  await server.connect(y); const client = new Client({ name: "qa0552-mm-mfa", version: "1" }); await client.connect(x);
  try {
    const viaMcp = (await client.callTool({ name: "apn_operation_status", arguments: { operation: id } })).structuredContent, viaCli = await cli(["operation", "status", "--operation", id]);
    assert.equal(viaCli.ok, true, JSON.stringify(viaCli.error)); assert.deepEqual(viaMcp.data, viaCli.data); assert.deepEqual(viaMcp.next_actions, [observe]);
    assert.equal(viaCli.data.mfa_task.request_id, RID);
  } finally { await client.close(); await server.close(); }
  // A notice naming another request proves nothing about this one: the stored task stays as it was.
  await answer(watchAnswer, { stdout: `${notice("TEST-other-request", later)}\n`, exit: 1 });
  const conflict = await observeCli(id);
  assert.equal(conflict.data.read_observation.reason, "provider_request_identity_conflict"); assert.equal(conflict.data.mfa_task.evidence_hash, sha(watched));
  // The owner approved: the watch names the transaction, its receipt settles the transfer. One hand-off in all.
  const hash = `0x${sha((await sends())[0])}`;
  await answer(watchAnswer, { exit: 0, stdout: JSON.stringify({ ok: true, data: { request: { pollingId: RID, kind: "transaction", namespace: "evm", chainId: 1, txHash: hash },
    status: { status: "CONFIRMED", txHash: hash } } }) });
  const settled = await observeCli(id);
  assert.equal(settled.ok, true, JSON.stringify(settled.error)); assert.equal(settled.data.state, "confirmed"); assert.equal(settled.data.transaction_hash, hash);
  assert.equal(settled.data.mfa_task, undefined); assert.deepEqual(settled.next_actions, []); assert.equal((await sends()).length, 1);
  assert.equal(await usage(TOKEN), AMOUNT);
  // A window that has already closed shows as expired; the provider's DENIED drops the task but never the UNKNOWN or its hold.
  await answer(sendAnswer, sent(new Date(Date.now() - 1000).toISOString()));
  const second = await transfer(RECIPIENT, "1000", "qa-native-mfa-0002"), RID2 = lastRequestId;
  assert.equal(second.ok, true, JSON.stringify(second.error)); assert.equal(second.data.mfa_task.status, "expired");
  assert.notEqual(RID2, RID); assert.match(second.data.mfa_task.owner_action, /never sends it again/u);
  // Its request was sent by the helper, so mm's local list never holds it: observe reads it from MetaMask's server, no watch.
  await rm(watchAnswer, { force: true });
  await answer(serverAnswer, { outcome: "verified", status: "DENIED", transactionHash: null, mfa: null, responseHash: "5".repeat(64) });
  const watchesBefore = (await children()).filter((argv) => argv[1] === "requests").length;
  const denied = await observeCli(second.data.operation_id);
  assert.equal((await children()).filter((argv) => argv[1] === "requests").length, watchesBefore, "no mm watch for a helper hand-off");
  assert.deepEqual((await children()).filter((argv) => argv[1] === "read-request").map((argv) => argv[2]), [RID2]);
  assert.equal(denied.data.read_observation.server_read.outcome, "verified"); assert.equal(denied.data.read_observation.watch_returned, false);
  assert.equal(denied.ok, true, JSON.stringify(denied.error)); assert.equal(denied.data.state, "unknown"); assert.equal(denied.data.mfa_task, undefined);
  assert.equal(denied.data.read_observation.provider_status, "DENIED");
  // The verified DENIED names the owner's exit: the transfer stays UNKNOWN with its hold, and abandon frees the account.
  assert.equal(denied.next_actions.length, 3);
  assert.match(denied.next_actions[0], new RegExp(`^MetaMask closed the request of APN ${second.data.operation_id} as DENIED at its approval step, before signing\\.`, "u"));
  assert.equal(JSON.stringify([second, denied]).includes(RID2), false, "a sealed request id is never shown");
  assert.equal(denied.next_actions[1], `apn wallet metamask native-transfer-observe --operation ${second.data.operation_id}`);
  assert.match(denied.next_actions[2], new RegExp(`: apn operation abandon --operation ${second.data.operation_id} \\(the reserves stay charged`, "u"));
  assert.equal((await sends()).length, 2); assert.equal(await usage(TOKEN), "3500");
}

try {
  const state = new StateStore(root), caps = metamaskDirectCapabilitySnapshot();
  await state.initialize();
  await state.writeProviderProfile({ schema_version: "apn.provider-profile.v1", profile: PROFILE, profile_hash: state.profileHash(PROFILE), provider_id: "metamask-agent-wallet",
    public_address: PAYER, account_binding_hash: accountBindingHash("metamask-agent-wallet", PAYER), capability_snapshot: caps, capability_hash: capabilityHash(caps),
    revision: 1, trust_class: "provider_managed_non_custodial_signer", observed_at: new Date().toISOString(), drift: { state: "bound", reason: "none" } });
  const policies = new AllowlistPolicyStore(root);
  const record = await policies.stage({ profile: PROFILE, now: new Date(), policy: { schemaVersion: "apn.allowlist-policy-file.v1", overlayVersion: "any-profile-1",
    accounts: { evm: PAYER }, effectiveAt: new Date().toISOString(), admissions: [
      { chain: "eip155:1", kind: "native", rail: "direct", maximumPerTransferAtomic: "100000000000000000", dailyLimitAtomic: "100000000000000000" },
      { chain: "eip155:1", kind: "token", identifier: USDC, rail: "direct", maximumPerTransferAtomic: "10000", dailyLimitAtomic: "10000",
        ...(scenario === "pinned" ? { recipients: [PINNED] } : {}) }] } });
  await policies.appendDecision(PROFILE, null, { status: "active", revision: record.revision, stagedRecordDigest: record.recordDigest,
    policyDigest: record.registry.policyDigest, registry: record.registry, approvalFingerprint: "a".repeat(64), decidedAt: new Date().toISOString() });

  if (scenario === "refusals") {
    // Every refusal comes before any vendor process, quote or journal: amount over the owner's cap, then a missing input.
    const over = await transfer(RECIPIENT, "10001", "qa-native-over-cap");
    assert.equal(over.ok, false); assert.equal(over.error.code, "APN_OPERATION_BLOCKED"); assert.match(over.error.message, /per-transfer cap/u);
    const missing = await cli(["wallet", "metamask", "native-transfer", "--chain", "ethereum", "--recipient", RECIPIENT, "--amount-atomic", AMOUNT, "--idempotency-key", "qa-native-no-profile"]);
    assert.equal(missing.ok, false); assert.equal(missing.error.code, "APN_INVALID_INPUT");
    const zero = await transfer("0x0000000000000000000000000000000000000000", AMOUNT, "qa-native-zero");
    assert.equal(zero.ok, false); assert.equal(zero.error.code, "APN_INVALID_INPUT");
    assert.equal((await children()).length, 0); assert.deepEqual(counts, { prepare: 0, guard: 0, observe: 0 });
    assert.deepEqual(await readdir(join(root, "metamask-native-operations")).catch(() => []), []);
  } else if (scenario === "guard-refused") {
    const refused = await transfer(RECIPIENT, AMOUNT, "qa-native-guard");
    assert.equal(refused.ok, false); assert.equal(refused.error.details.reason, "metamask_guard_recipient_not_allowlisted");
    assert.deepEqual((await children()).map((argv) => argv[1]), ["status", "trading-mode", "policy"]);
    assert.equal(counts.prepare, 0); assert.deepEqual(await readdir(join(root, "metamask-native-operations")).catch(() => []), []);
  } else if (scenario === "pinned") {
    // The owner's recipient pin (OD-1) refuses another recipient before the vendor is asked, then admits the pinned one.
    const refused = await transfer(RECIPIENT, AMOUNT, "qa-native-pin-0001");
    assert.equal(refused.ok, false); assert.equal(refused.error.code, "APN_ALLOWLIST_REFUSED"); assert.equal(refused.error.details.reason, "allowlist_recipient_not_admitted");
    assert.equal((await children()).length, 0);
    const admitted = await transfer(PINNED, AMOUNT, "qa-native-pin-0002");
    assert.equal(admitted.ok, true, JSON.stringify(admitted.error)); assert.equal(admitted.data.state, "acknowledged"); assert.equal(admitted.data.recipient, PINNED);
  } else if (scenario === "mfa") {
    await mfaScenario();
  } else {
    const result = await transfer(RECIPIENT, AMOUNT, "qa-native-0001");
    assert.equal(result.ok, true, JSON.stringify(result.error));
    const op = result.data;
    assert.equal(op.state, "acknowledged"); assert.equal(op.profile, PROFILE); assert.equal(op.sender, PAYER); assert.equal(op.recipient, RECIPIENT);
    assert.equal(op.usdc_atomic, AMOUNT); assert.equal(op.usdc, "0.0025"); assert.equal(op.effect_attempts, 1);
    // Three vendor reads before consent, three in the last guard, one hand-off (PROV-12: was 6 + 6 + 1).
    const argv = await children();
    assert.deepEqual(argv.map((a) => a[1]), ["status", "trading-mode", "policy", "status", "trading-mode", "policy", "send-transaction"]);
    // The request mm 6.1.5 built from 0.5.107's payload and intent, sent by the helper with APN's own id.
    const send = argv[6], tx = JSON.parse(send[2]), request = JSON.parse(send[3]);
    assert.equal(tx.data, encodeFunctionData({ abi: [{ type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] }],
      functionName: "transfer", args: [RECIPIENT, 2500n] }));
    assert.deepEqual([tx.from, tx.to, tx.chainId, tx.value, tx.nonce], [PAYER.toLowerCase(), USDC.toLowerCase(), 1, "0x0", 7]);
    assert.equal(request.intent, `APN ${op.operation_id}: 2500 atomic USDC to ${RECIPIENT}`);
    const journal = JSON.parse(await readFile(join(root, "metamask-native-operations", `${op.operation_id}.json`), "utf8"));
    assert.equal(journal.schemaVersion, "apn.metamask-native-operation.v2"); assert.equal("stateRoot" in journal.context, false);
    assert.equal(journal.context.quote.schemaVersion, "apn.metamask-native-fee-quote.v2"); assert.equal(journal.context.quote.recipient, RECIPIENT);
    assert.equal(journal.context.quote.amountAtomic, AMOUNT); assert.equal(journal.reservations[1].amountAtomic, AMOUNT);
    assert.deepEqual(counts, { prepare: 11, guard: 7, observe: 0 });
    // Same request replays without any vendor or chain read; the same key with another amount is a different request.
    assert.deepEqual((await transfer(RECIPIENT, AMOUNT, "qa-native-0001")).data, op);
    const collision = await transfer(RECIPIENT, "2600", "qa-native-0001");
    assert.equal(collision.ok, false); assert.match(collision.error.message, /idempotency collision/u);
    assert.equal((await children()).length, 7); assert.deepEqual(counts, { prepare: 11, guard: 7, observe: 0 });
    const observed = await cli(["wallet", "metamask", "native-transfer-observe", "--operation", op.operation_id]);
    assert.equal(observed.ok, true, JSON.stringify(observed.error)); assert.equal(observed.data.state, "confirmed");
    assert.equal(observed.data.receipt.transferAccepted, true); assert.equal(observed.data.receipt.nativeFeeAtomic, "100000");
    assert.equal(counts.observe, 5);
    assert.equal(await usage(TOKEN), AMOUNT); assert.equal(await usage(NATIVE), "100000");
    // Moving the APN home keeps every journal loading, so no EVM rail is blocked, and the next transfer runs from there.
    const moved = join(temp, "moved-home");
    await rename(root, moved); root = moved;
    const status = await cli(["wallet", "metamask", "native-transfer-status", "--operation", op.operation_id]);
    assert.equal(status.ok, true, JSON.stringify(status.error)); assert.equal(status.data.state, "confirmed");
    await new OperationService(new StateStore(root)).assertEvmAccountAvailable(new StateStore(root).profileHash(PROFILE), 1, PAYER.toLowerCase());
    const next = await transfer(RECIPIENT, "1000", "qa-native-0002");
    assert.equal(next.ok, true, JSON.stringify(next.error)); assert.equal(next.data.state, "acknowledged"); assert.equal(next.data.usdc_atomic, "1000");
    assert.equal(await usage(TOKEN), "3500");
  }
  process.stdout.write(`TEST_ANY_PROFILE_${scenario.toUpperCase()}_OK\n`);
} finally {
  await rm(temp, { recursive: true, force: true }); mock.restoreAll();
}
