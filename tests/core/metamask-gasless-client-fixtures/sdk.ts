import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { encodeFunctionData, parseAbi } from "viem";
import { mmPrivateHash, mmWalletIdentityHash } from "../../../src/metamask-gasless/identity.js";
import { mmQuoteHash } from "../../../src/metamask-gasless/economics.js";
import type { MetaMaskGaslessBinding, MetaMaskGaslessIntent, MetaMaskGaslessQuote,
  MetaMaskGaslessUnsignedResult } from "../../../src/metamask-gasless/model.js";
import { MM_CHAINS, mmRegistry } from "../../../src/metamask-gasless/registry.js";
import type { FetchExchange, FetchExchangeRequest, FetchExchangeResponse } from "../../../src/metamask-gasless/client/network.js";

export const NOW = new Date("2026-09-09T12:00:00.000Z");
export const OWNER = "0x1111111111111111111111111111111111111111" as const;
export const RECIPIENT = "0x2222222222222222222222222222222222222222" as const;
export const FEE_RECIPIENT = "0x3333333333333333333333333333333333333333" as const;
export const PROJECT = "synthetic-project";
export const SECRET = "synthetic-refresh-canary-never-output";
const transfer = parseAbi(["function transfer(address,uint256) returns (bool)"]);

export interface HomeOptions {
  readonly ref?: { readonly address: string } | { readonly name: string } | { readonly id: string };
  readonly remoteWallets?: readonly Record<string, unknown>[];
  readonly byokWallets?: readonly Record<string, unknown>[];
  readonly exp?: number;
}
export async function syntheticHome(options: HomeOptions = {}) {
  const home = await mkdtemp(join(await realpath(tmpdir()), "apn-mm-client-"));
  const directory = join(home, ".metamask"); await mkdir(directory, { mode: 0o700 });
  const payload = Buffer.from(JSON.stringify({ sub: PROJECT, exp: options.exp ?? 2_000_000_000, iat: 1_700_000_000 })).toString("base64url");
  const token = `e30.${payload}.synthetic-signature`;
  const ref = options.ref ?? { address: OWNER.toUpperCase().replace("0X", "0x") };
  const session = { schemaVersion: "1.0.0", data: { cliToken: token, cliRefreshToken: SECRET, projectId: PROJECT,
    chain: null, walletMode: "server-wallet", tradingMode: "guard", authMethod: "qr", loginMethod: "qr", consent: 0 } };
  const wallet = { schemaVersion: "0.0.1", data: { byokWallets: options.byokWallets ?? [],
    remoteWallets: options.remoteWallets ?? [{ address: OWNER, name: "primary", namespace: "evm" }],
    customEvmChains: [], customSolanaChains: [], selectedWallet: { mode: "server", namespace: "evm", ref }, pendingJobs: [] } };
  const sessionBytes = JSON.stringify(session), walletBytes = JSON.stringify(wallet);
  await writeFile(join(directory, "session.json"), sessionBytes, { mode: 0o600 });
  await writeFile(join(directory, "wallets.json"), walletBytes, { mode: 0o600 });
  const referenceKind = Object.keys(ref)[0] as "address" | "name" | "id";
  const reference = (ref as unknown as Record<string, string>)[referenceKind]!;
  const binding: MetaMaskGaslessBinding = { providerId: "metamask-agent-wallet", address: OWNER,
    accountBindingHash: "a".repeat(64), capabilityHash: "b".repeat(64), revision: 7,
    projectHash: mmPrivateHash("project", PROJECT), walletReferenceHash: mmPrivateHash("wallet-reference", reference, referenceKind),
    walletIdHash: mmWalletIdentityHash(OWNER), namespace: "eip155", mode: "server", environment: "prod" };
  return { home, directory, token, sessionBytes, walletBytes, binding, cleanup: () => rm(home, { recursive: true, force: true }) };
}

export class SdkExchange implements FetchExchange {
  readonly requests: FetchExchangeRequest[] = [];
  beforeSends = 0;
  constructor(readonly chainId: number, readonly status = 200, readonly malformed: string | null = null) {}
  async request(request: FetchExchangeRequest): Promise<FetchExchangeResponse> {
    this.requests.push(request); request.beforeSend?.(); if (request.beforeSend) this.beforeSends += 1;
    if (this.malformed === "inventory" && request.url.endsWith("/v1/supportedNetworks")) return { status: 200, body: "{}" };
    if (this.status !== 200) return { status: this.status, body: "{}" };
    let body: unknown;
    if (request.url.endsWith("/v1/supportedNetworks")) body = { networks: MM_CHAINS.map((chainId) => ({ chainId,
      name: `chain-${chainId}`, networkType: "mainnet", shieldSupported: true })) };
    else if (request.url.endsWith("/v2/supportedNetworks")) body = { fullSupport: MM_CHAINS.map((id) => `eip155:${id}`), partialSupport: [] };
    else if (request.url.endsWith("/networks")) body = Object.fromEntries(MM_CHAINS.map((id) => [id, { relayTransactions: true }]));
    else if (request.url.includes("rpc.example.test")) {
      const rpc = JSON.parse(request.body!) as { id: unknown; params: [{ data: string }] };
      body = { jsonrpc: "2.0", id: rpc.id, result: rpc.params[0].data === "0x313ce567" ? word(6n) : word(10_000_000_000n) };
    } else if (request.method === "POST" && request.url.includes("tx-sentinel-")) {
      body = this.malformed === "quote" ? { jsonrpc: "2.0", id: 10, result: { transactions: [] } } :
        { jsonrpc: "2.0", id: 10, result: { transactions: [{ fees: [{ tokenFees: [{ token: {
        address: mmRegistry(this.chainId).row.token, symbol: "USDC", decimals: 6 }, balanceNeededToken: "1000",
      feeRecipient: FEE_RECIPIENT }] }] }] } };
    } else if (request.method === "POST" && request.url.endsWith("/transaction-requests")) {
      const posted = JSON.parse(request.body!) as { requestId: string; tx: unknown };
      body = { requestId: this.malformed === "job" ? "00000000-0000-4000-8000-000000000099" : posted.requestId,
        status: "EVALUATING", tx: posted.tx };
    } else if (request.method === "GET" && request.url.includes("/transaction-requests/")) {
      const requestId = request.url.split("/").at(-1)!;
      body = { requestId: this.malformed === "job" ? "00000000-0000-4000-8000-000000000099" : requestId,
        status: "CONFIRMED", tx: { from: OWNER, chainId: this.chainId }, txHash: `0x${"44".repeat(32)}` };
    } else throw new Error(`unexpected synthetic request ${request.method} ${request.url}`);
    return { status: 200, body: JSON.stringify(body) };
  }
}

export function quoteInput(binding: MetaMaskGaslessBinding, chainId: typeof MM_CHAINS[number]) {
  return { binding, chainId, token: mmRegistry(chainId).row.token, recipient: RECIPIENT, netAtomic: "999000",
    rpcUrl: `https://rpc.example.test/${chainId}?api-key=synthetic` };
}
export function expectedQuote(chainId: typeof MM_CHAINS[number]): MetaMaskGaslessQuote {
  const token = mmRegistry(chainId).row.token, feeAtomic = chainId === 1 ? "1050" : "1000";
  const executions = [{ target: token, value: "0", callData: encodeFunctionData({ abi: transfer, functionName: "transfer",
    args: [RECIPIENT, 999000n] }) }, { target: token, value: "0", callData: encodeFunctionData({ abi: transfer,
      functionName: "transfer", args: [FEE_RECIPIENT, BigInt(feeAtomic)] }) }] as const;
  const material = { netAtomic: "999000", feeAtomic, feeRecipient: FEE_RECIPIENT, executions };
  return { ...material, hash: mmQuoteHash(material) };
}
export function intent(binding: MetaMaskGaslessBinding, chainId: typeof MM_CHAINS[number], quote: MetaMaskGaslessQuote,
  unsigned: MetaMaskGaslessUnsignedResult): MetaMaskGaslessIntent {
  const row = mmRegistry(chainId).row;
  const state = { protocolCodeHashes: { manager: row.protocol.manager.codeHash, delegate: row.protocol.delegate.codeHash,
    limitedCalls: row.protocol.limitedCalls.codeHash, exactBatch: row.protocol.exactBatch.codeHash },
    tokenProxyCodeHash: row.tokenProxyCodeHash, tokenImplementationAddress: row.tokenImplementationAddress,
    tokenImplementationCodeHash: row.tokenImplementationCodeHash, tokenDecimals: 6 as const, ownerCodeHash: `0x${"00".repeat(32)}` as const,
    designation: "empty" as const, usdcBalanceAtomic: "10000000", counterAtomic: "0" };
  return { profile: "fixture", request: { chainId, recipient: RECIPIENT, grossAtomic: (999000n + BigInt(quote.feeAtomic)).toString(),
    maxFeeAtomic: "2000", minReceivedAtomic: "999000" }, binding, token: mmRegistry(chainId).row.token, decimals: 6,
  deploymentEvidenceHash: mmRegistry(chainId).deploymentEvidenceHash, initialSnapshot: { chainId, endpointHash: "c".repeat(64),
    endpointOrigin: "https://rpc.example.test", observedAt: NOW.toISOString(), safeBlock: { numberAtomic: "1", hash: `0x${"11".repeat(32)}`,
      timestampAtomic: "1" }, headBlock: { numberAtomic: "1", hash: `0x${"11".repeat(32)}`, timestampAtomic: "1" }, safeState: state, headState: state },
  quote, requestId: "12345678-1234-4123-8123-123456789abc", preparedAt: NOW.toISOString(),
  expiresAt: new Date(NOW.getTime() + 300_000).toISOString(), policyHash: "d".repeat(64), ...unsigned };
}
function word(value: bigint): string { return `0x${value.toString(16).padStart(64, "0")}`; }
