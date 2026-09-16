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
const BRIDGE_TEMPLATE_SHA256 = "9c37a73126cd2947b6907ee0b10aea0e7c7cffb25cf334746d6730211ef67663";
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
