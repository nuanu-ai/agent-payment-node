import assert from "node:assert/strict";
import test from "node:test";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { StateStore } from "../../src/state.js";
import { ETHEREUM_USDT } from "../../src/swap/uniswap-v3/pins.js";
import { UNISWAP_USDC } from "../../src/swap/uniswap-pin.js";
import { UNISWAP_TOKEN_MECHANISM_PIN } from "../../src/swap/uniswap-v3/token-route.js";
import { createTokenRpc, tokenBatch, tokenChain, tokenHex, type TokenRpcCall } from "../../src/swap/uniswap-v3/token-rpc.js";
import { createUniswapTokenRuntime } from "../../src/swap/uniswap-v3/token-runtime-factory.js";
import { activateDirectPolicy } from "./direct-allowlist-helpers.js";
import { temporaryState } from "./helpers.js";
import { movingNode, pinsLikeProduction, typingTerminal, WRAPPING } from "./uniswap-token-moving-node-harness.js";

// QA F10: a token quote with only APN_ETHEREUM_RPC_URL refused "Historical bridge proof requires an explicitly configured
// archive RPC endpoint" although the docs declare the archive optional. Every read the lane sends on its archive route is
// pinned to a block the same command has just read from the primary, so the primary serves it, as it does for the lane's
// scalar reads and for the native-input lane.

const KEY = `0x${"0".repeat(63)}6` as Hex, ACCOUNT = privateKeyToAccount(KEY).address, PROFILE = "token-primary-only";
const PRIMARY = "https://rpc.example";

function session(state: StateStore, chain: ReturnType<typeof movingNode>, maxHttpRequests: number,
  environment: Readonly<Record<string, string>>, origins: string[]): TokenRpcCall {
  const node = chain.node;
  return createTokenRpc({ environment, state, now: () => node.rpcNow, pacingNow: () => node.rpcNow,
    wait: async (milliseconds) => { node.rpcNow += milliseconds; }, maxHttpRequests, deadlineMs: 300_000,
    transport: { request: async (url: string, method: string, body: string | null) => { origins.push(new URL(url).origin);
      return await chain.request(url, method, body); } } });
}

test("a token swap quotes, prepares, approves and observes with the primary RPC alone (scalar and pooled)", async (t) => {
  for (const environment of [{ APN_ETHEREUM_RPC_URL: PRIMARY }, { APN_UNISWAP_TOKEN_PRIMARY_RPC_URLS: JSON.stringify([PRIMARY]) }]) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const at = new Date(), state = new StateStore(temporary.root); await state.initialize();
    await new EncryptedWalletStore(state, WRAPPING).importNew(PROFILE, KEY, ACCOUNT);
    await activateDirectPolicy(temporary.root, PROFILE, { accounts: { evm: ACCOUNT }, now: at, admissions: [UNISWAP_USDC, ETHEREUM_USDT].map((identifier) => ({
      chain: "eip155:1", kind: "token" as const, identifier, rail: "swap" as const, maximumPerTransferAtomic: "1000000", dailyLimitAtomic: "3000000",
      mechanism: UNISWAP_TOKEN_MECHANISM_PIN })) });
    const chain = movingNode({ account: ACCOUNT, allowance: "0", pending: 9n }), terminal = typingTerminal(), origins: string[] = [];
    const run = (maxHttpRequests: number, foreground: "approve" | "refuse" = "refuse") => {
      const call = session(state, chain, maxHttpRequests, environment, origins);
      return { call, runtime: createUniswapTokenRuntime({ state, wrapping: WRAPPING, clock: { now: () => at }, call, foreground, tty: terminal.tty,
        verifyPins: pinsLikeProduction }) };
    };
    const archiveFree = (call: TokenRpcCall) => {
      const roles = call.telemetry!()!.attemptsByEndpointRole;
      assert.deepEqual([roles.archive, roles.receipt], [0, 0], JSON.stringify(roles));
    };
    let step = run(8);
    const quote = await step.runtime.quote({ command: "swap.uniswap-token.quote", profile: PROFILE, account: ACCOUNT, recipient: ACCOUNT,
      sourceToken: UNISWAP_USDC, outputToken: ETHEREUM_USDT, amountAtomic: "1000000", minimumOutputAtomic: "990000", approvalCapAtomic: "1000000",
      deadline: Math.floor(at.getTime() / 1000) + 600, maxApprovalGasLimit: "100000", maxSwapGasLimit: "200000", maxCleanupGasLimit: "100000",
      maxFeePerGas: "4", maxPriorityFeePerGas: "1", maxNativeDebitWei: "1600000" }) as { quoteHash: string };
    archiveFree(step.call);
    step = run(9);
    let op = await step.runtime.prepare({ command: "swap.uniswap-token.prepare", profile: PROFILE, quoteHash: quote.quoteHash, idempotencyKey: "token-primary-only-1" });
    archiveFree(step.call);
    step = run(14, "approve"); op = await step.runtime.approve(op.operationId);
    assert.equal(op.phase, "approval_submitted"); archiveFree(step.call);
    chain.land(chain.node.sends.at(-1)!, chain.node.head - 5n); chain.node.allowance = "1000000";
    step = run(11); op = await step.runtime.status(op.operationId);
    assert.equal(op.phase, "approval_observed"); archiveFree(step.call);
    assert.deepEqual([...new Set(origins)], [PRIMARY]);
  }
});

test("a configured archive or receipt reader still serves its own reads; without them the primary does", async (t) => {
  const pinned = [{ method: "eth_getCode", params: [ACCOUNT, "0x10"], cachePolicy: "none" as const, decoder: tokenHex() }];
  const receipt = [{ method: "eth_chainId", params: [], cachePolicy: "none" as const, decoder: tokenChain },
    { method: "eth_getTransactionReceipt", params: [`0x${"a".repeat(64)}`], cachePolicy: "none" as const, decoder: (value: unknown) => value }];
  for (const [environment, archive, receiptReader] of [
    [{ APN_ETHEREUM_RPC_URL: PRIMARY }, PRIMARY, PRIMARY],
    [{ APN_ETHEREUM_RPC_URL: PRIMARY, APN_ETHEREUM_ARCHIVE_RPC_URL: "https://archive.example" }, "https://archive.example", "https://archive.example"],
    [{ APN_ETHEREUM_RPC_URL: PRIMARY, APN_ETHEREUM_ARCHIVE_RPC_URL: "https://archive.example", APN_ETHEREUM_RECEIPT_RPC_URL: "https://receipt.example" },
      "https://archive.example", "https://receipt.example"],
  ] as const) {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const state = new StateStore(temporary.root), chain = movingNode({ account: ACCOUNT, allowance: "0", pending: 0n }), origins: string[] = [];
    const call = session(state, chain, 6, environment, origins);
    await tokenBatch(call, "archive", pinned);
    assert.deepEqual([...new Set(origins)], [archive], JSON.stringify(environment)); origins.length = 0;
    assert.equal((await tokenBatch(call, "receipt", receipt))[1], null);
    assert.deepEqual([...new Set(origins)], [receiptReader], JSON.stringify(environment));
  }
});
