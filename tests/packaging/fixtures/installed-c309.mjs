import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { privateKeyToAccount } from 'viem/accounts';
import { AllowlistPolicyStore, allowlistDecisionFingerprint, allowlistProfileHash } from '@nuanu-ai/apn/dist/allowlist-policy.js';
import { StateStore } from '@nuanu-ai/apn/dist/state.js';
import { EncryptedWalletStore } from '@nuanu-ai/apn/dist/encrypted-wallet-store.js';
import { RpcReadSession } from '@nuanu-ai/apn/dist/lifi/rpc.js';
import { createMcpServer } from '@nuanu-ai/apn/dist/mcp-server.js';
import { createUniswapTokenRuntime } from '@nuanu-ai/apn/dist/swap/uniswap-v3/token-runtime-factory.js';
import { UniswapTokenRpcBudgetJournal } from '@nuanu-ai/apn/dist/swap/uniswap-v3/token-rpc-budget.js';
import { ETHEREUM_USDT, UNISWAP_V3_QUOTER_V2 } from '@nuanu-ai/apn/dist/swap/uniswap-v3/pins.js';
import { UNISWAP_TOKEN_MECHANISM_PIN } from '@nuanu-ai/apn/dist/swap/uniswap-v3/token-route.js';
import { UNISWAP_USDC } from '@nuanu-ai/apn/dist/swap/uniswap-pin.js';

const NOW = new Date('2026-09-23T00:00:00.000Z');
const PROFILE = 'installed-c309-synthetic-owner';
const KEY = `0x${'0'.repeat(63)}1`;
const ACCOUNT = privateKeyToAccount(KEY).address;
const BLOCK = `0x${'b'.repeat(64)}`;
const word = n => `0x${n.toString(16).padStart(64, '0')}`;
const root = await mkdtemp('/private/tmp/apn-c309-synthetic-');
const installed = new URL('./node_modules/@nuanu-ai/apn/', import.meta.url);
const binary = new URL('bin/apn.js', installed).pathname;
const expected = [
  'apn_swap_ethereum_uniswap_token_quote',
  'apn_swap_ethereum_uniswap_token_prepare',
  'apn_swap_ethereum_uniswap_token_status',
  'apn_swap_ethereum_uniswap_token_approve',
  'apn_swap_ethereum_uniswap_token_execute',
  'apn_swap_ethereum_uniswap_token_cleanup',
];
const quoteArgs = { profile: PROFILE, account: ACCOUNT, to: ACCOUNT, source_token: ETHEREUM_USDT,
  output_token: UNISWAP_USDC, amount: '1000000', minimum_output: '990000', approval_cap: '1000000',
  deadline: String(Math.floor(NOW.getTime() / 1000) + 600), max_approval_gas_limit: '100000',
  max_swap_gas_limit: '200000', max_cleanup_gas_limit: '100000', max_fee_per_gas: '2',
  max_priority_fee_per_gas: '1', max_native_debit: '800000' };
const decode = result => { const item = result.content[0]; assert.equal(item?.type, 'text');
  const value = JSON.parse(item.text); assert.deepEqual(value, result.structuredContent); return value; };

function mockRpc() {
  let physical = 0, logical = 0, effects = 0;
  const methods = [];
  const value = (method, params) => {
    methods.push(method); if (method === 'eth_sendRawTransaction') effects++;
    if (method === 'eth_chainId') return '0x1';
    if (method === 'eth_getBlockByNumber') return { number: '0x64', hash: BLOCK, baseFeePerGas: '0x0' };
    if (method === 'eth_getTransactionCount') return '0x7';
    if (method === 'eth_getBalance') return '0x100000';
    if (method === 'eth_maxPriorityFeePerGas') return '0x1';
    if (method === 'eth_estimateGas') return '0x5208';
    if (method === 'eth_call') {
      const tx = params[0];
      if (tx.to === UNISWAP_V3_QUOTER_V2) return `0x${word(1000000n).slice(2)}${word(0n).slice(2)}${word(0n).slice(2)}${word(0n).slice(2)}`;
      if (tx.data.startsWith('0xdd62ed3e')) return word(0n);
      if (tx.data.startsWith('0x70a08231')) return word(2000000n);
      return '0x';
    }
    throw new Error(`unexpected RPC method ${method}`);
  };
  const call = async (method, params) => { physical++; logical++; return value(method, params); };
  Object.defineProperties(call, {
    batch: { value: async (_route, items) => { assert.ok(items.length >= 1 && items.length <= 3);
      physical++; logical += items.length; return items.map(x => value(x.method, x.params)); } },
    telemetry: { value: () => ({ ...new RpcReadSession().telemetry(), httpRequests: physical,
      httpAttempts: physical, logicalItems: logical }) },
    effectAttempts: { value: () => effects },
  });
  return { call, counts: () => ({ physical, logical, effects }), methods };
}

async function activateSyntheticPolicy() {
  const store = new AllowlistPolicyStore(root);
  const admission = identifier => ({ chain: 'eip155:1', kind: 'token', identifier, rail: 'swap',
    maximumPerTransferAtomic: '1000000', dailyLimitAtomic: '2000000', mechanism: UNISWAP_TOKEN_MECHANISM_PIN });
  const record = await store.stage({ profile: PROFILE, now: NOW, policy: {
    schemaVersion: 'apn.allowlist-policy-file.v1', overlayVersion: 'installed-c309-synthetic.1',
    accounts: { evm: ACCOUNT }, effectiveAt: new Date(NOW.getTime()-3600000).toISOString(),
    expiresAt: new Date(NOW.getTime()+86400000).toISOString(),
    admissions: [admission(ETHEREUM_USDT), admission(UNISWAP_USDC)] } });
  const before = await store.read(PROFILE);
  const fingerprint = allowlistDecisionFingerprint({ action: 'activate', profileHash: allowlistProfileHash(PROFILE),
    revision: record.revision, stagedRecordDigest: record.recordDigest, policyDigest: record.registry.policyDigest,
    headEntryDigest: before.entries.at(-1)?.entryDigest ?? null });
  await store.appendDecision(PROFILE, null, { status: 'active', revision: record.revision,
    stagedRecordDigest: record.recordDigest, policyDigest: record.registry.policyDigest,
    registry: record.registry, approvalFingerprint: fingerprint, decidedAt: NOW.toISOString() });
  return { revision: record.revision, digest: record.registry.policyDigest };
}

async function embeddedSession() {
  const state = new StateStore(root), fake = mockRpc(), secret = Buffer.alloc(32, 19);
  const wrapping = { load: async () => Buffer.from(secret), create: async () => Buffer.from(secret) };
  const runtime = createUniswapTokenRuntime({ state, wrapping, clock: { now: () => NOW }, call: fake.call,
    foreground: 'refuse', verifyPins: async (_call, tag) => assert.equal(tag, '0x64') });
  const server = createMcpServer({ stateRoot: root, uniswapTokenRuntime: runtime, clock: { now: () => NOW } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'installed-c309-embedded-client', version: '1' });
  await client.connect(clientTransport);
  return { ...fake, state, wrapping,
    invoke: async (action, args) => decode(await client.callTool({ name: `apn_swap_ethereum_uniswap_token_${action}`, arguments: args })),
    close: async () => { await client.close(); await server.close(); } };
}

try {
  const pkg = JSON.parse(await readFile(new URL('package.json', installed), 'utf8'));
  assert.equal(pkg.version, '0.5.26');
  const config = spawnSync(process.execPath, [binary, 'mcp', 'config'], { encoding: 'utf8' });
  assert.equal(config.status, 0, config.stderr);
  assert.deepEqual(JSON.parse(config.stdout), { schema_version: 'apn.mcp-launch.v1', transport: 'stdio', command: 'apn', args: ['mcp','serve'] });
  const stdio = new StdioClientTransport({ command: process.execPath, args: [binary, 'mcp', 'serve'], stderr: 'pipe' });
  const direct = new Client({ name: 'installed-c309-stdio-client', version: '1' });
  let stdioStderr = ''; stdio.stderr?.on('data', chunk => { stdioStderr += String(chunk); });
  await direct.connect(stdio);
  const tools = (await direct.listTools()).tools.map(x => x.name);
  assert.ok(expected.every(x => tools.includes(x)));
  const arbitraryOperation = 'a'.repeat(64), binaryHandoffs = {};
  for (const action of ['approve','execute','cleanup']) {
    const result = decode(await direct.callTool({ name: `apn_swap_ethereum_uniswap_token_${action}`,
      arguments: { operation: arbitraryOperation } }));
    assert.equal(result.error?.code, 'APN_FOREGROUND_APPROVAL_REQUIRED');
    assert.equal(result.error?.details?.cli_handoff, `apn swap ethereum uniswap-token ${action} --operation ${arbitraryOperation}`);
    binaryHandoffs[action] = result.error.code;
  }
  await direct.close(); assert.equal(stdioStderr, '');
  const policy = await activateSyntheticPolicy();
  const q = await embeddedSession();
  const quoted = await q.invoke('quote', quoteArgs);
  assert.equal(quoted.ok, true); assert.equal(quoted.data.expectedOutputAtomic, '1000000');
  assert.deepEqual(q.counts(), { physical: 4, logical: 7, effects: 0 });
  const quoteHash = quoted.data.quoteHash; await q.close();
  const p = await embeddedSession(); await p.state.initialize();
  await new EncryptedWalletStore(p.state, p.wrapping).importNew(PROFILE, KEY, ACCOUNT);
  const prepared = await p.invoke('prepare', { profile: PROFILE, quote: quoteHash, idempotency_key: 'installed-c309-synthetic' });
  assert.equal(prepared.ok, true); assert.equal(prepared.operation.phase, 'prepared');
  assert.equal(prepared.operation.approvalAttempt, null); assert.equal(prepared.operation.swapAttempt, null);
  assert.deepEqual(p.counts(), { physical: 5, logical: 10, effects: 0 });
  const operationId = prepared.operation.operationId; await p.close();
  const s = await embeddedSession();
  const status = await s.invoke('status', { operation: operationId });
  assert.equal(status.ok, true); assert.equal(status.operation.phase, 'prepared');
  const handoffs = {};
  for (const action of ['approve','execute','cleanup']) {
    const result = await s.invoke(action, { operation: operationId });
    assert.equal(result.error?.code, 'APN_FOREGROUND_APPROVAL_REQUIRED');
    assert.equal(result.error?.details?.cli_handoff, `apn swap ethereum uniswap-token ${action} --operation ${operationId}`);
    handoffs[action] = result.error.code;
  }
  assert.deepEqual(s.counts(), { physical: 0, logical: 0, effects: 0 }); await s.close();
  const rows = (await new UniswapTokenRpcBudgetJournal(root).load(operationId)).rows;
  assert.deepEqual(rows.map(x => [x.command,x.cap,x.physicalRequests,x.logicalItems]), [
    ['swap.uniswap-token.quote',8,4,7], ['swap.uniswap-token.prepare',9,5,10], ['swap.uniswap-token.status',0,0,0] ]);
  assert.ok(rows.every(x => x.attempts === x.physicalRequests && x.budgetRejects === 0));
  assert.equal(q.methods.includes('eth_sendRawTransaction'), false);
  assert.equal(p.methods.includes('eth_sendRawTransaction'), false);
  assert.equal(s.methods.length, 0);
  console.log(JSON.stringify({ packageVersion: pkg.version, installedBinary: binary, stdioToolCount: tools.length,
    stdioHandoffs: binaryHandoffs, syntheticPolicy: policy, quote: { hash: quoteHash, expectedOutputAtomic: quoted.data.expectedOutputAtomic,
      physical: q.counts().physical, logical: q.counts().logical, methods: q.methods },
    prepare: { operationId, phase: prepared.operation.phase, physical: p.counts().physical,
      logical: p.counts().logical, methods: p.methods },
    status: { phase: status.operation.phase, physical: s.counts().physical, logical: s.counts().logical },
    handoffs, rpcJournal: rows.map(x => ({ command: x.command, cap: x.cap, physical: x.physicalRequests,
      logical: x.logicalItems, attempts: x.attempts, budgetRejects: x.budgetRejects })),
    broadcasts: q.counts().effects + p.counts().effects + s.counts().effects,
    publicRpcRequests: 0, signerAttemptsDirectlyInstrumented: false }, null, 2));
} finally { await rm(root, { recursive: true, force: true }); }
