import assert from "node:assert/strict";
import test from "node:test";
import { encodeAbiParameters, encodeFunctionData, parseAbi } from "viem";
import { bindArgv } from "../../src/command-binder.js";
import { MCP_FOREGROUND_HANDOFF, MCP_TOOLS } from "../../src/mcp-projection.js";
import { ApnCore } from "../../src/core.js";
import { StateStore } from "../../src/state.js";
import { temporaryState } from "./helpers.js";
import { UNISWAP_ROUTER, UNISWAP_USDC, decodeUniswapRouterCalldataFor, validateUniswapReceipt } from "../../src/swap/index.js";

const ACCOUNT = "0x1a642f0E3c3aF545E7AcBD38b07251B3990914F1", RECIPIENT = "0x2222222222222222222222222222222222222222";
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", H = (c: string) => c.repeat(64);
const deadline = 1_790_000_600, input = "1000000000000000", output = "2000000", minimum = "1980000";
const executeAbi = parseAbi(["function execute(bytes commands, bytes[] inputs, uint256 deadline) payable"]);
function calldata(command = 0x00, recipient = RECIPIENT, amountOutMin = minimum, fee = 3000, minHopPriceX36: readonly bigint[] = []) {
  const path = `0x${WETH.slice(2)}${fee.toString(16).padStart(6, "0")}${UNISWAP_USDC.slice(2)}` as `0x${string}`;
  const wrap = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], ["0x0000000000000000000000000000000000000002", BigInt(input)]);
  const swap = encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bool" },
    { type: "uint256[]" }], [recipient as `0x${string}`, BigInt(input), BigInt(amountOutMin), path, false, minHopPriceX36]);
  const commands = `0x0b${command.toString(16).padStart(2, "0")}` as `0x${string}`;
  return encodeFunctionData({ abi: executeAbi, functionName: "execute", args: [commands, [wrap, swap], BigInt(deadline)] });
}
const decodeUniswapRouterCalldataForUsdc = (data: `0x${string}`, expected: { readonly recipient: string; readonly inputAmountAtomic: string;
  readonly minimumOutputAtomic: string; readonly deadline: number }) => decodeUniswapRouterCalldataFor(data, { ...expected, outputToken: UNISWAP_USDC });
function envelope() { return { from: ACCOUNT, to: UNISWAP_ROUTER, data: calldata(), value: input, gasLimit: "150000", chainId: 1,
  maxFeePerGas: "2000000000", maxPriorityFeePerGas: "100000000" } as const; }

test("Universal Router decoder proves recipient, input, output floor and deadline and rejects command extension or subplan", () => {
  const decoded = decodeUniswapRouterCalldataForUsdc(calldata(), { recipient: RECIPIENT, inputAmountAtomic: input, minimumOutputAtomic: minimum, deadline });
  assert.equal(decoded.command, "V3_SWAP_EXACT_IN"); assert.equal(decoded.minimumOutputAtomic, minimum);
  const alternateFee = decodeUniswapRouterCalldataForUsdc(calldata(0x00, RECIPIENT, minimum, 500),
    { recipient: RECIPIENT, inputAmountAtomic: input, minimumOutputAtomic: minimum, deadline });
  assert.notEqual(alternateFee.routeHash, decoded.routeHash);
  const perHop = decodeUniswapRouterCalldataForUsdc(calldata(0x00, RECIPIENT, minimum, 3000, [1n]),
    { recipient: RECIPIENT, inputAmountAtomic: input, minimumOutputAtomic: minimum, deadline });
  assert.notEqual(perHop.routeHash, decoded.routeHash);
  assert.throws(() => decodeUniswapRouterCalldataForUsdc(calldata(0x21), { recipient: RECIPIENT, inputAmountAtomic: input, minimumOutputAtomic: minimum, deadline }), { code: "APN_PROVIDER_PROTOCOL" });
  assert.throws(() => decodeUniswapRouterCalldataForUsdc(calldata(0x00, ACCOUNT), { recipient: RECIPIENT, inputAmountAtomic: input, minimumOutputAtomic: minimum, deadline }), { code: "APN_PROVIDER_PROTOCOL" });
  assert.throws(() => decodeUniswapRouterCalldataForUsdc(calldata(0x00, RECIPIENT, "1"), { recipient: RECIPIENT, inputAmountAtomic: input, minimumOutputAtomic: minimum, deadline }), { code: "APN_PROVIDER_PROTOCOL" });
  const legacySwap = encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bool" }],
    [RECIPIENT, BigInt(input), BigInt(minimum), `0x${WETH.slice(2)}000bb8${UNISWAP_USDC.slice(2)}`, false]);
  const wrap = encodeAbiParameters([{ type: "address" }, { type: "uint256" }], ["0x0000000000000000000000000000000000000002", BigInt(input)]);
  const legacy = encodeFunctionData({ abi: executeAbi, functionName: "execute", args: ["0x0b00", [wrap, legacySwap], BigInt(deadline)] });
  assert.throws(() => decodeUniswapRouterCalldataForUsdc(legacy, { recipient: RECIPIENT, inputAmountAtomic: input,
    minimumOutputAtomic: minimum, deadline }), { code: "APN_PROVIDER_PROTOCOL" });
});

test("final receipt requires exact transaction, successful receipt, output log, balance deltas and finalized head", () => {
  const txHash = `0x${H("c")}` as const, blockHash = `0x${H("d")}` as const;
  const recipientTopic = `0x${RECIPIENT.slice(2).toLowerCase().padStart(64, "0")}` as `0x${string}`;
  const proof = validateUniswapReceipt({ transactionHash: txHash, transaction: { hash: txHash, from: ACCOUNT, to: UNISWAP_ROUTER,
    input: calldata(), value: input, blockNumber: "100", blockHash }, receipt: { transactionHash: txHash, status: "0x1",
    blockNumber: "100", blockHash, logs: [{ address: UNISWAP_USDC, topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", `0x${H("0")}`, recipientTopic],
      data: `0x${BigInt(minimum).toString(16).padStart(64, "0")}` }] }, beforeNative: "2000000000000000", afterNative: "900000000000000",
    beforeOutput: "0", afterOutput: minimum, finalizedHead: { number: "110", hash: `0x${H("e")}` }, observedAt: "2026-09-17T00:00:00.000Z" },
  envelope(), { transactionHash: txHash, account: ACCOUNT, recipient: RECIPIENT, inputAmountAtomic: input, minimumOutputAtomic: minimum,
    outputToken: UNISWAP_USDC });
  assert.equal(proof.finalized, true);
});

test("final receipt accepts a real V3 swap's multi-word pool Swap log and credits only one-word output Transfers", () => {
  const txHash = `0x${H("c")}` as const, blockHash = `0x${H("d")}` as const, word = (v: string) => BigInt(v).toString(16).padStart(64, "0");
  const recipientTopic = `0x${RECIPIENT.slice(2).toLowerCase().padStart(64, "0")}` as `0x${string}`, pool = `0x${H("7")}` as `0x${string}`;
  const transfer = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;
  const receipt = (outputData: `0x${string}`) => validateUniswapReceipt({ transactionHash: txHash, transaction: { hash: txHash, from: ACCOUNT,
    to: UNISWAP_ROUTER, input: calldata(), value: input, blockNumber: "100", blockHash }, receipt: { transactionHash: txHash, status: "0x1",
    blockNumber: "100", blockHash, logs: [
      { address: WETH, topics: ["0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c", pool], data: `0x${word(input)}` },
      { address: UNISWAP_USDC, topics: [transfer, pool, recipientTopic], data: outputData },
      { address: WETH, topics: [transfer, pool, pool], data: `0x${word(input)}` },
      { address: "0x4e68ccd3e89f51c3074ca5072bbac773960dfa36", topics: ["0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67",
        pool, recipientTopic], data: `0x${word("1").repeat(5)}` }] }, beforeNative: "2000000000000000", afterNative: "900000000000000",
    beforeOutput: "0", afterOutput: minimum, finalizedHead: { number: "110", hash: `0x${H("e")}` }, observedAt: "2026-09-17T00:00:00.000Z" },
  envelope(), { transactionHash: txHash, account: ACCOUNT, recipient: RECIPIENT, inputAmountAtomic: input, minimumOutputAtomic: minimum,
    outputToken: UNISWAP_USDC });
  assert.equal(receipt(`0x${word(minimum)}`).finalized, true);
  assert.throws(() => receipt(`0x${word(minimum)}${word("0")}`), { code: "APN_OPERATION_BLOCKED", message: /exact successful finalized swap/u });
  assert.throws(() => receipt("0x0" as `0x${string}`), { code: "APN_OPERATION_BLOCKED" });
});

test("CLI and MCP expose identical dormant surface; inventory grants no admission and prepare/execute refuse stably", async (t) => {
  for (const action of ["inventory", "quote", "prepare", "status"]) assert.ok(MCP_TOOLS.some((row) => row.name === `apn_swap_ethereum_uniswap_${action}`));
  for (const action of ["approve", "execute"]) assert.ok(MCP_FOREGROUND_HANDOFF.commands.some((row) => row.path.join(" ") === `swap ethereum uniswap ${action}`));
  assert.equal(bindArgv(["swap", "ethereum", "uniswap", "inventory"]).request.command, "swap.uniswap.inventory");
  const temporary = await temporaryState(); t.after(temporary.cleanup); const core = new ApnCore({ state: new StateStore(temporary.root) });
  const inventory = await core.execute({ command: "swap.uniswap.inventory" }); assert.equal(inventory.ok, true);
  assert.equal((inventory.data as any).ownerAdmission.evaluated, false); assert.equal((inventory.data as any).execution, "dormant");
  assert.equal(Object.hasOwn(inventory.data as object, "catalog"), false);
  const prepare = await core.execute({ command: "swap.uniswap.prepare", profile: "swap-test", quoteHash: H("1"), idempotencyKey: "uniswap-test-0001" });
  assert.equal(prepare.error?.code, "APN_OPERATION_BLOCKED");
  const approve = await core.execute({ command: "swap.uniswap.approve", operationId: H("2") });
  assert.equal(approve.error?.details?.reason, "uniswap_native_no_approval");
  const execute = await core.execute({ command: "swap.uniswap.execute", operationId: H("2") });
  assert.equal(execute.error?.details?.reason, "uniswap_execution_dormant");
});

test("CLI inputs reject noncanonical integers and hashes", () => {
  const args = ["swap", "ethereum", "uniswap", "quote", "--profile", "swap-test", "--account", ACCOUNT, "--to", RECIPIENT,
    "--output-token", UNISWAP_USDC, "--amount", input, "--slippage-bps", "1e2", "--owner-slippage-cap-bps", "100", "--deadline", String(deadline),
    "--max-gas-limit", "150000", "--max-fee-per-gas", "2000000000", "--max-priority-fee-per-gas", "100000000"];
  assert.throws(() => bindArgv(args), { code: "APN_INVALID_INPUT" });
  assert.throws(() => bindArgv(["swap", "ethereum", "uniswap", "status", "--operation", H("A")]), { code: "APN_INVALID_INPUT" });
});

test("slippage above the owner cap is refused with its reason and both values", () => {
  const args = ["swap", "ethereum", "uniswap", "quote", "--profile", "swap-test", "--account", ACCOUNT, "--to", RECIPIENT,
    "--output-token", UNISWAP_USDC, "--amount", input, "--slippage-bps", "200", "--owner-slippage-cap-bps", "100", "--deadline", String(deadline),
    "--max-gas-limit", "150000", "--max-fee-per-gas", "2000000000", "--max-priority-fee-per-gas", "100000000"];
  assert.throws(() => bindArgv(args), { code: "APN_INVALID_INPUT", message: "Uniswap slippage 200 bps exceeds the owner cap of 100 bps.",
    details: { reason: "swap_slippage_above_owner_cap", slippage_bps: "200", owner_slippage_cap_bps: "100" } });
});
