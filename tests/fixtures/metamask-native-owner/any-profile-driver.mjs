// TEST ONLY. The real CLI path (`runCli`: argv binding, core dispatch, owner, the real vendor adapter and process runner,
// the real RPC module and EvmRpc, journal and usage ledger) for a profile that is not the owner's, with its own recipient
// and amount. Only the edges are synthetic: a fake `mm` child script and an in-memory JSON-RPC chain. No HOME, Keychain,
// network or money. Runs in a pseudo-terminal so the real foreground consent prompt is answered.
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
else if(a[1]==="send-transaction"){const payload=a[a.indexOf("--payload")+1];data={mode:"server",address:payer,hash:"0x"+crypto.createHash("sha256").update(payload).digest("hex"),chainId:1,projectId:project};}
else throw new Error("TEST unexpected vendor argv");
process.stdout.write(JSON.stringify({ok:true,data}));`, { mode: 0o600 });
const originalPackage = await import(moduleUrl("metamask-package.js"));
await mock.module(moduleUrl("metamask-package.js"), { namedExports: { ...originalPackage, resolveMetaMaskBin: async () => script } });

// In-memory chain: answers by phase (prepare, guard before the hand-off, observe after it) and counts every RPC call.
const counts = { prepare: 0, guard: 0, observe: 0 };
const children = async () => (await readFile(log, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
const sends = async () => (await children()).filter((argv) => argv[1] === "send-transaction").map((argv) => argv[argv.indexOf("--payload") + 1]);
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
      if (method === "eth_getTransactionByHash") return { hash: params[0], chainId: "0x1", blockHash, blockNumber: tag, from: PAYER.toLowerCase(), to: p.to,
        type: "0x2", value: "0x0", nonce: p.nonce, gas: p.gas, maxFeePerGas: p.maxFeePerGas, maxPriorityFeePerGas: p.maxPriorityFeePerGas, input: p.data };
      const to = `0x${p.data.slice(34, 74)}`, amount = BigInt(`0x${p.data.slice(74, 138)}`);
      return { transactionHash: params[0], blockHash, blockNumber: tag, status: "0x1", gasUsed: "0xc350", effectiveGasPrice: "0x2", logs: [{
        address: p.to, topics: [TRANSFER_TOPIC, word(PAYER), word(to)], data: word(amount), transactionHash: params[0], blockHash, blockNumber: tag, removed: false }] };
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
const noKeychain = { load: async () => { throw new Error("TEST no Keychain"); }, create: async () => { throw new Error("TEST no Keychain"); } };
const cli = (argv) => runCli(argv, process.env, { stateRoot: root, wrappingSecret: noKeychain });
const transfer = (recipient, amount, key) => cli(["wallet", "metamask", "native-transfer", "--profile", PROFILE, "--chain", "ethereum",
  "--recipient", recipient, "--amount-atomic", amount, "--idempotency-key", key]);
const usage = async (asset) => (await new AssetUsageLedger(root).usage({ account: PAYER, chain: "eip155:1", asset }, new Date())).amountAtomic;
const NATIVE = { kind: "native", identifier: null }, TOKEN = { kind: "token", identifier: USDC };

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
  } else {
    const result = await transfer(RECIPIENT, AMOUNT, "qa-native-0001");
    assert.equal(result.ok, true, JSON.stringify(result.error));
    const op = result.data;
    assert.equal(op.state, "acknowledged"); assert.equal(op.profile, PROFILE); assert.equal(op.sender, PAYER); assert.equal(op.recipient, RECIPIENT);
    assert.equal(op.usdc_atomic, AMOUNT); assert.equal(op.usdc, "0.0025"); assert.equal(op.effect_attempts, 1);
    // Three vendor reads before consent, three in the last guard, one hand-off (PROV-12: was 6 + 6 + 1).
    const argv = await children();
    assert.deepEqual(argv.map((a) => a[1]), ["status", "trading-mode", "policy", "status", "trading-mode", "policy", "send-transaction"]);
    const send = argv[6], payload = JSON.parse(send[send.indexOf("--payload") + 1]);
    assert.equal(payload.data, encodeFunctionData({ abi: [{ type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] }],
      functionName: "transfer", args: [RECIPIENT, 2500n] }));
    assert.equal(payload.to, USDC); assert.equal(send[send.indexOf("--intent") + 1], `APN ${op.operation_id}: 2500 atomic USDC to ${RECIPIENT}`);
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
