import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { gunzipSync } from "node:zlib";
import { hash, loadModule, reinstall, scenario } from "./harness.mjs";

const NOW = new Date("2026-09-09T00:00:00.000Z");
const RPC_ORIGIN = "https://rpc.example";
const X402_URL = "https://seller.example/resource?order=redacted";
const X402_PAYEE = "0x2222222222222222222222222222222222222222";
const SOLANA_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const SOLANA_SENDER = "So11111111111111111111111111111111111111112";
const SOLANA_RECIPIENT = "11111111111111111111111111111111";
// Synthetic input, not a live provider quote. Generated from the source compatibility fixture with:
// node --input-type=module: lifiFixture(root).prepare("across", "retained-bridge-template-0001"),
// then gzipSync(JSON.stringify({ intent: prepared.operation.intent, effects: prepared.operation.effects })).
const BRIDGE_TEMPLATE_SHA256 = "e87c0e2ea2716ec99c0e6eefbcb81eb7fcebf82d48d8b7ef3da54bada4891042";
const BRIDGE_TEMPLATE_GZIP = "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";

export async function runInstalledRetainedProof(installed) {
  const modules = await installedModules(installed.packageRoot);
  const reverse = [];
  let reinstalledRoot;
  const cases = [
    ["local-direct", buildLocalDirect],
    ["local-x402", buildLocalX402],
    ["provider-x402", buildProviderX402],
    ["solana-rail", buildRail],
    ["lifi-bridge", buildBridge],
    ["local-gasless", buildLocalGasless],
  ];
  for (const [name, build] of cases) {
    const s = await scenario(installed);
    const old = await build(s, modules);
    await restoreMetaMaskProfile(s, modules);
    const before = await retainedSnapshot(s);
    assert.ok(before.files.has(old.operationPath), `${name}: old operation is in the retained byte snapshot`);
    assert.ok(before.files.has(old.profilePath), `${name}: provider profile is in the retained byte snapshot`);
    const traceBefore = await s.trace(), privateBefore = await s.privateBytes();
    if (reinstalledRoot === undefined) reinstalledRoot = await reinstall(s);
    else s.update({ packageRoot: reinstalledRoot });

    const blocked = await s.cli(s.prepareArgv(`mm-after-${name}-0001`));
    const sameDomain = ["local-direct", "local-x402", "provider-x402", "local-gasless"].includes(name);
    if (sameDomain) {
      assert.equal(blocked.ok, false, `${name}: ${JSON.stringify(blocked)}`);
      assert.deepEqual(blocked.error.details, {
        blockingOperationId: old.operationId,
        blockingState: "awaiting_approval",
        blockingNetwork: "evm:8453",
        blockingAccount: s.fixture().owner.toLowerCase(),
      }, name);
    } else {
      // Solana and source-chain bridge journals use different conflict domains, so MetaMask
      // may prepare on Base while retaining the old operation byte-for-byte.
      assert.equal(blocked.ok, true, `${name}: ${JSON.stringify(blocked)}`);
      assert.notEqual(blocked.error?.code, "APN_OPERATION_BLOCKED", name);
    }
    const conflict = await s.cli(s.prepareArgv(old.idempotencyKey));
    assert.equal(conflict.ok, false, JSON.stringify(conflict));
    assert.equal(conflict.error.code, "APN_IDEMPOTENCY_CONFLICT", name);

    const traceAfter = await s.trace();
    if (sameDomain) assert.deepEqual(traceAfter, traceBefore, `${name}: no installed transport call`);
    assert.deepEqual(traceAfter.filter(entry => entry.kind === "provider-post"), [], `${name}: no provider POST`);
    assert.equal(s.fixture().postCount, 0, `${name}: no provider POST`);
    assert.deepEqual(await s.privateBytes(), privateBefore, `${name}: MetaMask private state retained`);
    const after = await retainedSnapshot(s);
    assert.deepEqual(after.files.get(old.operationPath), before.files.get(old.operationPath), `${name}: old operation retained`);
    assert.deepEqual(after.files.get(old.profilePath), before.files.get(old.profilePath), `${name}: provider profile retained`);
    if (sameDomain) assert.deepEqual(after, before, `${name}: blocked operation made no write`);
    reverse.push({ family: name, operationId: old.operationId, blockingState: sameDomain ? "awaiting_approval" : "different_conflict_domain",
      sameKey: "APN_IDEMPOTENCY_CONFLICT", transportCalls: 0, providerPosts: 0 });
  }

  const pending = await scenario(installed);
  const { id } = await pending.prepare("mm-retained-lifecycle-0001");
  const before = await retainedSnapshot(pending), traceBefore = await pending.trace(), privateBefore = await pending.privateBytes();
  assert.notEqual(reinstalledRoot, undefined); pending.update({ packageRoot: reinstalledRoot });
  const lifecycle = [];
  for (const [command, argv] of [
    ["wallet.ensure", ["wallet", "ensure", "--profile", pending.profile]],
    ["wallet.status", ["wallet", "status", "--profile", pending.profile]],
    ["wallet.balance", ["wallet", "balance", "--profile", pending.profile, "--rpc-url", pending.fixture().rpcUrl]],
  ]) {
    const result = await pending.cli(argv);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error.code, "APN_OPERATION_BLOCKED", command);
    assert.deepEqual(result.error.details, { blockingOperationId: id, blockingState: "awaiting_approval" }, command);
    lifecycle.push({ command, operationId: id, blockingState: "awaiting_approval" });
  }
  assert.deepEqual(await pending.trace(), traceBefore, "pending MM lifecycle made no installed transport call");
  assert.equal(pending.fixture().postCount, 0, "pending MM lifecycle made no provider POST");
  assert.deepEqual(await pending.privateBytes(), privateBefore, "pending MM lifecycle retained private state");
  assert.deepEqual(await retainedSnapshot(pending), before, "pending MM lifecycle retained durable state byte-for-byte");

  return { proofClass: "installed_archive_retained_cross_family_boundary",
    archiveSha256: installed.identity.archiveSha256, sameArchiveReinstall: true,
    reinstall: { archiveSha256: installed.identity.archiveSha256,
      packageJsonSha256: hash(await readFile(join(reinstalledRoot, "package.json"))),
      binarySha256: hash(await readFile(join(reinstalledRoot, "bin/apn.js"))) },
    reverse, lifecycle };
}

async function installedModules(packageRoot) {
  const [core, state, canonical, constants, profiles, policy, profileRepository, providerRegistry, awal,
    providerX402Stage, providerX402State, providerX402Repository, chainAccount, chainPolicy, railModel, railRepository,
    bridgeTransitions, bridgeRepository, gaslessRegistry] = await Promise.all([
    loadModule(packageRoot, "core.js"), loadModule(packageRoot, "state.js"), loadModule(packageRoot, "canonical.js"),
    loadModule(packageRoot, "constants.js"), loadModule(packageRoot, "provider-profile.js"),
    loadModule(packageRoot, "profile-policy.js"), loadModule(packageRoot, "profile-repository.js"),
    loadModule(packageRoot, "provider-registry.js"), loadModule(packageRoot, "awal-process-adapter.js"),
    loadModule(packageRoot, "provider-x402-stage.js"), loadModule(packageRoot, "provider-x402-state.js"),
    loadModule(packageRoot, "provider-x402-repository.js"),
    loadModule(packageRoot, "chain-account-store.js"), loadModule(packageRoot, "chain-policy.js"),
    loadModule(packageRoot, "rail-operation-model.js"), loadModule(packageRoot, "rail-operation-repository.js"),
    loadModule(packageRoot, "lifi/transitions.js"), loadModule(packageRoot, "lifi/operation-repository.js"),
    loadModule(packageRoot, "gasless/registry.js"),
  ]);
  return { ...core, ...state, ...canonical, ...constants, ...profiles, ...policy, ...profileRepository,
    ...providerRegistry, ...awal, ...providerX402Stage, ...providerX402State, ...providerX402Repository, ...chainAccount,
    ...chainPolicy, ...railModel, ...railRepository, ...bridgeTransitions, ...bridgeRepository, ...gaslessRegistry };
}

async function buildLocalDirect(s, m) {
  const core = await localCore(s, m);
  const idempotencyKey = "retained-local-direct-0001";
  const result = await core.execute({ command: "transfer.prepare", profile: s.profile,
    recipient: s.fixture().recipient, amount: "1", idempotencyKey });
  return prepared(s, result, idempotencyKey, "operations");
}

async function buildLocalX402(s, m) {
  const core = await localCore(s, m, { http: x402Http(m), policy: profilePolicy(m), rpc: evmRpc(s, m) });
  const idempotencyKey = "retained-local-x402-0001";
  const result = await core.execute({ command: "x402.fetch.prepare", profile: s.profile,
    url: X402_URL, maxAmountAtomic: "2000000", idempotencyKey });
  return prepared(s, result, idempotencyKey, "x402-operations");
}

async function buildProviderX402(s, m) {
  const state = new m.StateStore(s.stateRoot); await state.initialize();
  const bound = await writeAwalProfile(s, state, m);
  const idempotencyKey = "retained-provider-x402-0001";
  const operationId = state.operationId(s.profile, idempotencyKey), idempotencyHash = state.idempotencyHash(idempotencyKey);
  const endpoint = new URL(X402_URL), rpcUrl = `${RPC_ORIGIN}/base`;
  const requirements = x402Requirements(m);
  const staged = m.stagedProviderX402Operation({ operationId, idempotencyHash, profile: s.profile,
    profileHash: state.profileHash(s.profile), requestHash: m.hashObject({
      method: "x402.fetch.prepare", profile: s.profile, canonicalUrl: endpoint.toString(), rpcUrl,
      methodShape: "GET_absent_body", callerCapAtomic: "2000000",
    }), endpoint, rpcUrl, callerCapAtomic: "2000000", effectiveCapAtomic: "2000000", bound,
    policy: sealedPolicy(m, { profile: s.profile, profileHash: state.profileHash(s.profile),
      walletAddress: bound.public_address, walletBindingHash: bound.account_binding_hash }),
    selected: { requirements, amountAtomic: requirements.amount, payee: requirements.payTo,
      digest: m.hashObject(requirements) }, createdAt: NOW.toISOString() });
  const record = m.transitionProviderX402Operation(staged, "awaiting_approval", "x402_awaiting_authorization",
    "x402_frozen_offer", { preparedBalance: { amountAtomic: "50000000", observedAt: NOW.toISOString(),
      accountBindingHash: bound.account_binding_hash } }, NOW.toISOString());
  const records = new m.ProviderX402Repository(s.stateRoot); await records.writeOperation(staged); await records.writeOperation(record);
  return retained(s, idempotencyKey, operationId, "x402-operations");
}

async function buildRail(s, m) {
  const state = new m.StateStore(s.stateRoot); await state.initialize(); await writeAwalProfile(s, state, m);
  const idempotencyKey = "retained-solana-rail-0001", profileHash = state.profileHash(s.profile);
  const operationId = state.operationId(s.profile, idempotencyKey);
  const account = m.sealChainAccount({ schemaVersion: "apn.chain-account.v1", profile: s.profile, profileHash,
    rail: "solana", network: "mainnet", provider: "coinbase-awal", custody: "provider_managed",
    address: SOLANA_SENDER, createdAt: NOW.toISOString() });
  const preparedTransfer = { rail: "solana", networkIdentity: SOLANA_GENESIS,
    asset: m.chainAsset("solana", "sol"), sender: account.address, recipient: SOLANA_RECIPIENT,
    amountAtomic: "1000", maximumFeeAtomic: "5000",
    economics: { networkFeeMaximumAtomic: "5000", recipientRentAtomic: "0", maximumNativeDebitAtomic: "0",
      networkFeePayer: SOLANA_RECIPIENT, rentPayer: null, feeControl: "provider_guarantee" },
    preparedAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + 300_000).toISOString(),
    blockReference: SOLANA_RECIPIENT, lastValidBlockHeight: "200", unsignedPayload: null,
    sourceTokenAccount: null, destinationTokenAccount: null, createsRecipientAccount: false };
  const record = m.newRailOperation({ schemaVersion: "apn.rail-operation.v1", kind: "rail_transfer",
    operationId, profile: s.profile, profileHash, idempotencyHash: state.idempotencyHash(idempotencyKey),
    requestHash: m.hashObject({ profile: s.profile, rail: "solana", asset: "sol", recipient: SOLANA_RECIPIENT,
      amountAtomic: "1000", maximumFeeAtomic: "5000" }), account, prepared: preparedTransfer,
    policyHash: m.hashObject({ identity: "retained-provider-guarantee", profile: s.profile }) });
  const records = new m.RailOperationRepository(s.stateRoot); await records.persist(record);
  return retained(s, idempotencyKey, operationId, "rail-operations");
}

async function buildBridge(s, m) {
  const state = new m.StateStore(s.stateRoot); await state.initialize();
  await ensureLocalWallet(s, state, m);
  // The compressed fixture is a frozen external LI.FI input. The installed
  // operation factory and repository are the validation and persistence authority.
  const templateBytes = gunzipSync(Buffer.from(BRIDGE_TEMPLATE_GZIP, "base64"));
  assert.equal(hash(templateBytes), BRIDGE_TEMPLATE_SHA256, "synthetic LI.FI fixture identity");
  const template = JSON.parse(templateBytes.toString("utf8"));
  const profileHash = state.profileHash(s.profile), idempotencyKey = "retained-lifi-bridge-0001";
  const operationId = state.operationId(s.profile, idempotencyKey);
  const intent = { ...template.intent, profile: s.profile,
    owner: { ...template.intent.owner, profile: s.profile, profileHash } };
  const requestHash = m.hashObject({ profile: s.profile, quote: intent.quoteHash, route: intent.materialization.routeId });
  const record = m.newBridgeOperation({ profileHash, operationId, idempotencyHash: state.idempotencyHash(idempotencyKey),
    requestHash, intent, effects: template.effects });
  const records = new m.BridgeOperationRepository(s.stateRoot); await records.persist(record);
  return retained(s, idempotencyKey, operationId, "bridge-operations");
}

async function buildLocalGasless(s, m) {
  const state = new m.StateStore(s.stateRoot); await state.initialize(); await ensureLocalWallet(s, state, m);
  const rpc = gaslessRpc(s, m);
  const forbiddenCustody = new Proxy({}, { get: (_target, property) => async () => {
    throw new Error(`unexpected retained gasless custody call: ${String(property)}`);
  } });
  const core = new m.ApnCore({ state, gasless: { rpcFor: chain => {
    assert.equal(chain, 8453); return rpc;
  }, custody: forbiddenCustody }, clock: { now: () => new Date(NOW) } });
  const idempotencyKey = "retained-local-gasless-0001";
  const result = await core.execute({ command: "gasless.transfer.prepare", profile: s.profile,
    request: { chainId: 8453, recipient: "0x4444444444444444444444444444444444444444",
      grossAtomic: "10000000", maxFeeAtomic: "200000", minReceivedAtomic: "9800000" }, idempotencyKey });
  return prepared(s, result, idempotencyKey, "gasless-operations");
}

async function localCore(s, m, overrides = {}) {
  const state = new m.StateStore(s.stateRoot); await state.initialize(); await ensureLocalWallet(s, state, m);
  return new m.ApnCore({ state, profileRepository: new m.StateProfileRepository(state), native: localNative(s),
    rpc: overrides.rpc ?? evmRpc(s, m), policy: overrides.policy ?? profilePolicy(m),
    ...(overrides.http === undefined ? {} : { http: overrides.http }), clock: { now: () => new Date(NOW) } });
}

async function ensureLocalWallet(s, state, m) {
  await state.removeProviderProfile(state.profileHash(s.profile));
  const core = new m.ApnCore({ state, profileRepository: new m.StateProfileRepository(state), native: localNative(s),
    clock: { now: () => new Date(NOW) } });
  const result = await core.execute({ command: "wallet.ensure", profile: s.profile });
  assert.equal(result.ok, true, JSON.stringify(result));
}

function localNative(s) {
  return { async request(request) {
    if (request.operation === "wallet.ensure") return { profile: s.profile, address: s.fixture().owner,
      createdAt: "2026-09-08T00:00:00.000Z", bindingHash: "a".repeat(64) };
    if (request.operation === "wallet.describe") return { found: true, profile: s.profile, address: s.fixture().owner,
      createdAt: "2026-09-08T00:00:00.000Z", bindingHash: "a".repeat(64) };
    throw new Error(`unexpected retained native call: ${request.operation}`);
  } };
}

function evmRpc(s, m) {
  return {
    async assertBaseChain() { return { chainId: 8453, rpcOrigin: RPC_ORIGIN }; },
    async getBalances(address) { return { address, ethAtomic: "1000000000000000000", usdcAtomic: "50000000",
      blockNumberAtomic: "12345", blockHash: `0x${"b".repeat(64)}`, observedAt: NOW.toISOString(), rpcOrigin: RPC_ORIGIN }; },
    async getPendingNonce() { return "7"; },
    async estimateDirectTransfer() { return { gasLimitAtomic: "65000", maxFeePerGasAtomic: "2000000000",
      maxPriorityFeePerGasAtomic: "1000000000" }; },
    async getX402PrepareEvidence(address) { return { address, usdcAtomic: "50000000", tokenName: "USD Coin",
      tokenVersion: "2", domainSeparator: "0x02fa7265e7c5d81118673727957699e4d68f74cd74b7db77da710fe8a2c7834f",
      rpcOriginHash: m.sha256(RPC_ORIGIN), observedAt: NOW.toISOString(), queriedTag: "safe",
      block: { number: "12345", hash: `0x${"b".repeat(64)}`, timestamp: Math.floor(NOW.getTime() / 1000).toString() } }; },
  };
}

function profilePolicy(m) {
  return { async load(binding) { return sealedPolicy(m, binding); },
    async set(binding, input) { return sealedPolicy(m, binding, input); } };
}

function sealedPolicy(m, binding, values = {}) {
  return m.sealProfilePolicy({ schemaVersion: "apn.profile-policy.v1", ...binding,
    maxBalanceUsdcAtomic: values.maxBalanceUsdcAtomic ?? "100000000",
    maxX402AmountAtomic: values.maxX402AmountAtomic ?? "10000000",
    maxBalanceEthWei: values.maxBalanceEthWei ?? "2000000000000000000",
    approvedAt: "2026-09-08T00:00:00.000Z", updatedAt: "2026-09-08T00:00:00.000Z" });
}

function x402Requirements(m) {
  return { scheme: "exact", network: "eip155:8453", amount: "1250000", asset: m.BASE_USDC,
    payTo: X402_PAYEE, maxTimeoutSeconds: 60, extra: { name: "USD Coin", version: "2" } };
}

function x402Http(m) {
  const header = Buffer.from(JSON.stringify({ x402Version: 2,
    resource: { url: X402_URL, description: "Bounded JSON result", mimeType: "application/json" },
    accepts: [x402Requirements(m)] }), "utf8").toString("base64");
  return { async get() { return { status: 402, rawHeaderPairs: [["PAYMENT-REQUIRED", header]],
    bodyBytes: new Uint8Array(), finalUrl: X402_URL, observedOrigin: new URL(X402_URL).origin,
    dnsAddresses: ["1.1.1.1"], selectedAddress: "1.1.1.1", startedAt: NOW.toISOString(),
    observedAt: new Date(NOW.getTime() + 1).toISOString(),
    safeTransportProvenance: { protocol: "https", tlsAuthorized: true, redirectCount: 0 } }; } };
}

function gaslessRpc(s, m) {
  const row = m.gaslessDeployment(8453), rpcOrigin = "https://rpc-8453.example";
  return { chainId: 8453, async assertChain() {}, async snapshot(owner) { return {
    chainId: 8453, rpcOrigin, rpcEndpointHash: m.hashObject(rpcOrigin), bundlerOrigin: "https://bundler.example",
    bundlerEndpointHash: m.hashObject("bundler"), block: { numberAtomic: "100", hash: `0x${m.hashObject("100")}`,
      timestampAtomic: Math.floor(NOW.getTime() / 1000).toString() }, protocolHash: m.gaslessProtocolHash(row),
    owner, token: row.token, balanceAtomic: "100000000", nativeBalanceWei: "0", allowanceAtomic: "0",
    permitNonceAtomic: "7", entryPointNonceAtomic: "9", eoaNonceAtomic: "1", pendingEoaNonceAtomic: "1",
    delegation: "empty", feeConfiguration: { additionalGasCharge: "35000", feeSpread: "100",
      nativeTokenPrice: "2500000000" }, baseFeePerGas: "1000000", maxFeePerGas: "2100000",
    maxPriorityFeePerGas: "100000" }; },
    async estimate(intent) { return { verificationGasLimit: "90000", callGasLimit: "200000",
      paymasterVerificationGasLimit: "180000", paymasterPostOpGasLimit: "35000",
      preVerificationGas: intent.initialSnapshot.delegation === "empty" ? "140000" : "120000",
      responseHash: m.hashObject("estimate") }; } };
}

async function writeAwalProfile(s, state, m) {
  const capabilities = m.coinbaseDirectCapabilitySnapshot();
  const record = { schema_version: "apn.provider-profile.v1", profile: s.profile,
    profile_hash: state.profileHash(s.profile), provider_id: m.AWAL_PROVIDER_ID,
    public_address: s.fixture().owner, account_binding_hash: m.accountBindingHash(m.AWAL_PROVIDER_ID, s.fixture().owner),
    trust_class: "provider_managed_non_custodial_tee", revision: 1, capability_snapshot: capabilities,
    capability_hash: m.capabilityHash(capabilities), observed_at: NOW.toISOString(),
    drift: { state: "bound", reason: "none" } };
  await state.writeProviderProfile(record); return record;
}

async function restoreMetaMaskProfile(s, m) {
  const state = new m.StateStore(s.stateRoot); await state.initialize();
  // Test-only public rebind creates historical cross-family state. It does not
  // authorize or model a production provider rebind.
  await state.writeProviderProfile(s.publicProfile);
}

function prepared(s, result, idempotencyKey, directory) {
  assert.equal(result.ok, true, JSON.stringify(result));
  const operationId = result.operation?.operation_id ?? result.operation?.operationId;
  assert.equal(typeof operationId, "string", JSON.stringify(result));
  return retained(s, idempotencyKey, operationId, directory);
}

function retained(s, idempotencyKey, operationId, directory) {
  const profileHash = s.publicProfile.profile_hash;
  return { idempotencyKey, operationId,
    operationPath: relative(s.stateRoot, join(s.stateRoot, directory, profileHash, `${operationId}.json`)),
    profilePath: relative(s.stateRoot, join(s.stateRoot, "profiles", profileHash, "profile.json")) };
}

async function retainedSnapshot(s) {
  const files = new Map(), directories = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name), name = relative(s.stateRoot, path);
      if (name === "locks" || name.startsWith("locks/")) continue;
      if (entry.isDirectory()) { directories.push(name); await visit(path); }
      else if (entry.isFile()) files.set(name, await readFile(path));
    }
  }
  await visit(s.stateRoot);
  return { directories, files };
}
