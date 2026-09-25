import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const source = resolve(import.meta.dirname, "../..");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const OWNER = "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7";
const RECIPIENT = "0x000000000000000000000000000000000000dEaD";
const NOW = new Date((0x6aacecdb - 300) * 1000);
const QUOTE = { quotes: [{ postOpGas: "0x4c2c", exchangeRate: "0xa38ca6e3",
  exchangeRateNativeToUsd: "0x948f68af", balanceSlot: "0x2", allowanceSlot: "0x5" }] };
const PRICE = { slow: { maxFeePerGas: "0x10ef719d", maxPriorityFeePerGas: "0xbb0de7a" },
  standard: { maxFeePerGas: "0x11c8374b", maxPriorityFeePerGas: "0xc468333" },
  fast: { maxFeePerGas: "0x12a0fcf9", maxPriorityFeePerGas: "0xcdc27ec" } };
const PAYMASTER_DATA = "0x020000006aacecdb000000000000dac17f958d2ee523a2206206994597c13d831ec700000000000000000000000000004c2c00000000000000000000000000000000000000000000000000000000a38ca6e3000000000000000000000000000138804337ff05c84b9a80ea0a78dbe7b8e102f66d4c08972391719016554aea7ecb13e50f38e455f67da2908c40238d37d162d3f3dc686067c76c198b6239400746330724b6191afa40a35538022086b0288210f55e1c1c";

async function run(command, args, cwd) {
  return await new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, npm_config_ignore_scripts: "true" } });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => resolveRun({ code, stdout, stderr }));
  });
}

test("packed APN installs and prepares one synthetic policy bound USDT without money effects", { timeout: 240000 }, async t => {
  const sandbox = await mkdtemp(join(await realpath(tmpdir()), "apn-usdt-installed-"));
  t.after(async () => rm(sandbox, { recursive: true, force: true }));
  const packed = await run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", sandbox], source);
  assert.equal(packed.code, 0, packed.stderr);
  const [{ filename }] = JSON.parse(packed.stdout);
  const archive = join(sandbox, filename), archiveHash = digest(await readFile(archive));
  const installed = await run("npm", ["install", "--ignore-scripts", "--offline", "--no-audit", "--no-fund",
    "--prefix", sandbox, archive], sandbox);
  assert.equal(installed.code, 0, installed.stderr);
  assert.equal(digest(await readFile(archive)), archiveHash);
  const packageRoot = join(sandbox, "node_modules", "@nuanu-ai", "apn");
  const moduleAt = path => import(pathToFileURL(join(packageRoot, "dist", path)).href);
  const { USDT_GASLESS } = await moduleAt("gasless-usdt/model.js");
  const { sealAssetPolicyRegistry } = await moduleAt("asset-policy-registry.js");
  const { runCli } = await moduleAt("cli.js");
  const { allowlistProfileHash } = await moduleAt("allowlist-policy-overlay.js");
  const { UsdtCommandReadBudget } = await moduleAt("gasless-usdt/command-prepare.js");
  const { StateStore } = await moduleAt("state.js");
  assert.equal(JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")).name, "@nuanu-ai/apn");
  const registry = sealAssetPolicyRegistry({ schemaVersion: "apn.asset-policy-registry.v2", registryVersion: "installed.1",
    publishedAt: "2026-09-18T00:00:00.000Z", effectiveDate: "2026-09-18", effectiveAt: "2026-09-18T00:00:00.000Z",
    chains: [{ chain: "eip155:1", family: "evm", name: "Ethereum", assets: [{ kind: "token",
      identifier: USDT_GASLESS.token, symbol: "USDT", decimals: 6,
      rails: { direct: false, gasless: true, x402: false, bridge: false, swap: false },
      railCaps: { gasless: { maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "2000000" } },
      mechanismPins: { gasless: USDT_GASLESS.mechanism } }] }] });
  const policy = { profile: "owner", registry, digest: registry.policyDigest, revision: 1,
    activationDigest: "a".repeat(64), accounts: { evm: OWNER }, activatedAt: "2026-09-18T00:00:00.000Z" };
  let active = policy, physical = 0, sponsorCalls = 0;
  const safe = { chainId: 1n, blockNumber: 26_002_950n, blockHash: `0x${"12".repeat(32)}`,
    account: { usdtBalanceAtomic: 1_000_000n, entryPointNonce: 7n, eoaNonce: 31n, delegation: "empty" } };
  const preparePort = { now: () => NOW, activePolicy: async () => active, dailyUsage: async () => "0",
    safeSnapshot: async () => { physical++; return safe; } };
  const sponsorPort = { tokenQuote: async () => { physical++; sponsorCalls++; return { quotes: [{ ...QUOTE.quotes[0],
    paymaster: USDT_GASLESS.paymaster, token: USDT_GASLESS.token }] }; },
  gasPrice: async () => { physical++; sponsorCalls++; return PRICE; },
  paymasterData: async () => { physical++; sponsorCalls++; return { paymaster: USDT_GASLESS.paymaster,
    paymasterData: PAYMASTER_DATA }; } };
  let forbiddenEffects = 0;
  const noEffect = async () => { forbiddenEffects++; throw new Error("synthetic fixture forbids execution"); };
  const executionDisabled = { approval: { approve: noEffect }, signer: { sign: noEffect },
    sendTransport: { send: noEffect } };
  const stateRoot = join(sandbox, "state"), options = { stateRoot, clock: { now: () => NOW },
    gaslessUsdtPrepareOptions: { preparePort, sponsorPort }, gaslessUsdtExecuteOptions: executionDisabled };
  const argv = ["gasless", "usdt", "prepare", "--profile", "owner", "--to", RECIPIENT,
    "--amount", "1", "--max-fee", "0.5", "--min-received", "0.5", "--idempotency-key", "installed-usdt-001"];
  const prepared = await runCli(argv, {}, options);
  assert.equal(prepared.ok, true, JSON.stringify(prepared.error));
  const operation = prepared.operation;
  assert.equal(operation.profileHash, allowlistProfileHash("owner"));
  assert.equal(operation.binding.plan.request.grossAtomic, "1000000");
  assert.equal(operation.binding.plan.netAtomic, "500000");
  assert.equal(operation.binding.unsignedOperation.callData, operation.binding.callData);
  assert.equal(operation.signerBoundary, "unavailable");
  assert.equal(operation.usageReservation, "disabled");
  assert.equal(operation.dispatch, "disabled");
  assert.equal(physical, 6);
  assert.equal(sponsorCalls, 5);
  assert.ok(physical <= 7);
  const journal = join(stateRoot, "gasless-usdt-bound-operations", operation.profileHash, `${operation.operationId}.json`);
  assert.deepEqual(JSON.parse(await readFile(journal, "utf8")), operation);
  const statusArgs = ["gasless", "usdt", "status", "--profile-hash", operation.profileHash,
    "--operation", operation.operationId];
  const status = await runCli(statusArgs, {}, { stateRoot });
  assert.equal(status.ok, true);
  assert.deepEqual(status.operation, operation);
  const countBeforeReplay = physical;
  assert.deepEqual((await runCli(argv, {}, options)).operation, operation);
  assert.equal(physical, countBeforeReplay);
  active = null;
  const { GaslessUsdtOperationService } = await moduleAt("gasless-usdt/service.js");
  const { UsdtOperationRepository } = await moduleAt("gasless-usdt/operation.js");
  const service = new GaslessUsdtOperationService(new UsdtOperationRepository(stateRoot)).forProfile(operation.profileHash);
  const revoked = await service.resumeBound(operation.operationId, preparePort);
  assert.deepEqual({ state: revoked.state, reason: revoked.reason },
    { state: "capability_unavailable", reason: "policy_revoked_or_changed" });
  active = policy;
  assert.equal((await service.resumeBound(operation.operationId, preparePort)).state, "prepared");
  const { UsdtExecutionJournal, usdtExecutionIntent } = await moduleAt("gasless-usdt/execution-journal.js");
  const { AssetUsageLedger } = await moduleAt("asset-usage-ledger.js");
  const execution = new UsdtExecutionJournal(stateRoot);
  const usageIdentity = { account: OWNER, chain: USDT_GASLESS.chain,
    asset: { kind: "token", identifier: USDT_GASLESS.token } };
  const intent = usdtExecutionIntent(operation);
  assert.equal(intent.bindingHash, operation.binding.bindingHash);
  const reserved = await execution.reserve(operation, intent, preparePort);
  assert.equal(reserved.state, "reserved");
  assert.equal(reserved.userOperationHash, null);
  assert.equal(reserved.policyDigest, policy.digest);
  assert.deepEqual(await execution.reserve(operation, intent, preparePort), reserved);
  await assert.rejects(() => execution.reserve(operation, { ...intent, recipient: OWNER }, preparePort),
    { code: "APN_IDEMPOTENCY_CONFLICT" });
  assert.deepEqual(JSON.parse(await readFile(join(stateRoot, "gasless-usdt-executions", `${operation.operationId}.json`), "utf8")), reserved);
  const reopenedExecution = new UsdtExecutionJournal(stateRoot);
  const reopenedUsage = new AssetUsageLedger(stateRoot);
  assert.deepEqual(await reopenedExecution.load(operation.operationId), reserved);
  assert.equal((await reopenedUsage.load(usageIdentity, reserved.reservationId))?.state, "reserved");
  assert.equal((await reopenedUsage.usage(usageIdentity, NOW)).amountAtomic, "1000000");
  await assert.rejects(() => execution.markSubmitting(operation, preparePort, "0xinvalid"),
    { code: "APN_OPERATION_BLOCKED" });
  assert.equal((await execution.load(operation.operationId))?.state, "reserved");
  const aborted = await reopenedExecution.abortUnsent(operation, NOW);
  assert.equal(aborted?.state, "failed_before_effect");
  assert.equal(aborted?.userOperationHash, null);
  assert.equal((await reopenedUsage.load(usageIdentity, reserved.reservationId))?.state, "failed_before_effect");
  assert.equal((await reopenedUsage.usage(usageIdentity, NOW)).amountAtomic, "0");
  assert.deepEqual(await execution.abortUnsent(operation, NOW), aborted);
  assert.deepEqual(await new UsdtExecutionJournal(stateRoot).load(operation.operationId), aborted);
  const refusedArgs = [...argv]; refusedArgs[refusedArgs.indexOf("--amount") + 1] = "1.000001";
  refusedArgs[refusedArgs.indexOf("--idempotency-key") + 1] = "installed-usdt-over-cap";
  const beforeRefusal = physical;
  const refused = await runCli(refusedArgs, {}, options);
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "APN_OPERATION_BLOCKED");
  assert.equal(physical, beforeRefusal, "cap refusal must precede public reads");
  assert.equal((await readdir(join(stateRoot, "gasless-usdt-bound-operations", operation.profileHash))).filter(x => x.endsWith(".json")).length, 1);
  const attemptedArgs = [...argv];
  attemptedArgs[attemptedArgs.indexOf("--idempotency-key") + 1] = "installed-usdt-attempted";
  const attempted = (await runCli(attemptedArgs, {}, options)).operation;
  const attemptedIntent = usdtExecutionIntent(attempted);
  const attemptedReservation = await execution.reserve(attempted, attemptedIntent, preparePort);
  const syntheticHash = `0x${"34".repeat(32)}`;
  const submitting = await execution.markSubmitting(attempted, preparePort, syntheticHash);
  assert.equal(submitting.state, "submitting");
  assert.equal(submitting.userOperationHash, syntheticHash);
  assert.equal(submitting.bindingHash, attempted.binding.bindingHash);
  assert.equal(submitting.quoteHash, attemptedIntent.quoteHash);
  assert.equal(submitting.reservationId, attemptedReservation.reservationId);
  assert.deepEqual(await new UsdtExecutionJournal(stateRoot).load(attempted.operationId), submitting);
  assert.equal((await runCli(["gasless", "usdt", "execution-status", "--profile-hash", attempted.profileHash,
    "--operation", attempted.operationId], {}, { stateRoot })).data.execution.state, "submitting");
  await assert.rejects(() => execution.markSubmitting(attempted, preparePort, syntheticHash),
    { code: "APN_OPERATION_BLOCKED" });
  assert.deepEqual(await execution.reserve(attempted, attemptedIntent, preparePort), submitting);
  await assert.rejects(() => execution.markSubmitted(attempted, `0x${"56".repeat(32)}`, NOW),
    { code: "APN_OPERATION_BLOCKED" });
  assert.equal((await reopenedUsage.load(usageIdentity, attemptedReservation.reservationId))?.state, "reserved");
  const { UsdtRecoveryService } = await moduleAt("gasless-usdt/recovery.js");
  let lookups = 0, canonicalReads = 0;
  const recovery = new UsdtRecoveryService(new UsdtExecutionJournal(stateRoot), {
    userOperationReceipt: async hash => { lookups++; assert.equal(hash, syntheticHash);
      return { userOpHash: `0x${"78".repeat(32)}`, sender: OWNER,
        entryPoint: USDT_GASLESS.entryPoint, paymaster: USDT_GASLESS.paymaster,
        success: true, transactionHash: `0x${"9a".repeat(32)}` }; },
    canonicalFinalizedReceipt: async () => { canonicalReads++; throw new Error("wrong locator must not be followed"); },
  }, () => NOW);
  const unknown = await recovery.observe(attempted);
  assert.equal(unknown.state, "unknown_finality");
  assert.equal(unknown.userOperationHash, syntheticHash);
  assert.equal(lookups, 1);
  assert.equal(canonicalReads, 0);
  assert.deepEqual(await recovery.observe(attempted), unknown);
  assert.equal(lookups, 2);
  assert.equal((await reopenedUsage.load(usageIdentity, attemptedReservation.reservationId))?.state, "unknown_finality");
  assert.equal((await reopenedUsage.usage(usageIdentity, NOW)).amountAtomic, "1000000");
  assert.equal((await execution.abortUnsent(attempted, NOW)), null);
  assert.deepEqual(await new UsdtExecutionJournal(stateRoot).load(attempted.operationId), unknown);
  const executionPath = join(stateRoot, "gasless-usdt-executions", `${attempted.operationId}.json`);
  const originalExecutionBytes = await readFile(executionPath);
  assert.ok(originalExecutionBytes.toString("utf8").includes(syntheticHash));
  await writeFile(executionPath, originalExecutionBytes.toString("utf8").replace(syntheticHash, `0x${"ab".repeat(32)}`));
  await assert.rejects(() => new UsdtExecutionJournal(stateRoot).load(attempted.operationId),
    { code: "APN_STATE_CORRUPT" });
  await writeFile(executionPath, originalExecutionBytes);
  assert.deepEqual(await new UsdtExecutionJournal(stateRoot).load(attempted.operationId), unknown);
  assert.equal(forbiddenEffects, 0);
  let now = 1_000, attempts = 0;
  const budget = new UsdtCommandReadBudget(new StateStore(stateRoot), { request: async () => {
    attempts++; return { status: 200, body: "{}" }; } }, () => now, async ms => { now += ms; });
  for (let index = 0; index < 7; index++) await budget.request("https://public.pimlico.io/v2/1/rpc", "POST", "{}", 1024, "APN_RPC_CONFIG");
  await assert.rejects(() => budget.request("https://public.pimlico.io/v2/1/rpc", "POST", "{}", 1024, "APN_RPC_CONFIG"),
    { code: "APN_RPC_CONFIG" });
  assert.equal(attempts, 7);
  assert.equal(operation.usageReservation, "disabled");
});
