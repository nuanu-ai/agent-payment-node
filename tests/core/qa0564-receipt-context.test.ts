/**
 * QA 0.5.64 DIRECT-RECEIPT-PARTICIPANT-CONTEXT-063-001: `receipt get` for 16 completed local EVM direct transfers (e.g.
 * 3352da…a12d, ETH on Ethereum) and one AWAL Base gasless transfer gave amount, fee and hash but no sender, recipient or,
 * for AWAL, chain/token/decimals; only `operation status` named them. The receipt now projects the frozen parties and
 * asset of the operation it is sealed to. Nothing stored is rewritten: the context comes from the validated operation.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import * as mcpRuntime from "../../src/mcp-server.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { EVM_REQUEST, ensureDirectWallet, evmCore } from "./evm-helpers.js";
import { EVM_USDC } from "./direct-allowlist-helpers.js";
import { RECIPIENT, temporaryState } from "./helpers.js";
import { testRuntime } from "./installed-runtime.js";

const { createMcpServer } = await testRuntime(mcpRuntime, "mcp-server.js");
const CONTEXT = ["profile", "chain", "token", "wallet_address", "recipient", "amount"] as const;

for (const scenario of [
  { name: "ETH on Ethereum", token: "native" as const, amount: "0.000001", expected: { token: null, atomic: "1000000000000", decimals: 18 } },
  { name: "USDC on Ethereum", token: EVM_USDC[1], amount: "1.5", expected: { token: EVM_USDC[1], atomic: "1500000", decimals: 6 } },
]) {
  test(`a completed ${scenario.name} direct receipt names its sender, recipient and asset in CLI and MCP`, async (t) => {
    const temporary = await temporaryState(); t.after(temporary.cleanup);
    const setup = evmCore(temporary.root); setup.rpc.chainId = 1; setup.rpc.l1Fee = 0n; setup.rpc.operatorFee = 0n;
    const wallet = await ensureDirectWallet(setup); setup.rpc.sender = wallet.address;
    const prepared = await setup.core.transfer.prepare({ ...EVM_REQUEST, asset: { chainId: 1, token: scenario.token }, amount: scenario.amount,
      idempotencyKey: `qa0564-receipt-${scenario.token === "native" ? "eth" : "usdc"}` }) as { operation_id: string };
    assert.equal((await setup.core.transfer.approve(prepared.operation_id) as { state: string }).state, "completed");
    const stored = (await setup.state.findOperation(prepared.operation_id))!;
    const sealed = (await setup.state.loadReceipt(stored.profileHash, stored.operationId))!;
    const server = createMcpServer({ stateRoot: temporary.root, rpc: setup.rpc, wrappingSecret: setup.wrapping }); const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b); const client = new Client({ name: "qa0564-receipt-context", version: "1" }); await client.connect(a);
    t.after(async () => { await client.close(); await server.close(); });
    const mcp = async (name: string) => (await client.callTool({ name, arguments: { operation: prepared.operation_id } })).structuredContent as unknown as OutputEnvelope;
    const [cliStatus, cliReceipt, mcpReceipt] = [await setup.core.execute({ command: "operation.status", operationId: prepared.operation_id }),
      await setup.core.execute({ command: "receipt.get", operationId: prepared.operation_id }), await mcp("apn_receipt_get")];
    for (const envelope of [cliStatus, cliReceipt, mcpReceipt]) assert.equal(envelope.ok, true, JSON.stringify(envelope));
    assert.deepEqual(mcpReceipt.receipt, cliReceipt.receipt);
    const receipt = cliReceipt.receipt as Record<string, unknown>, status = cliStatus.operation as Record<string, unknown>;
    assert.deepEqual({ profile: receipt.profile, chain: receipt.chain, token: receipt.token, wallet_address: receipt.wallet_address,
      recipient: receipt.recipient, amount: receipt.amount }, { profile: "default", chain: "eip155:1", token: scenario.expected.token,
      wallet_address: wallet.address, recipient: RECIPIENT, amount: { atomic: scenario.expected.atomic, decimal: scenario.amount,
        decimals: scenario.expected.decimals } });
    for (const key of CONTEXT) assert.deepEqual(receipt[key], status[key], key);
    assert.equal(receipt.receipt_hash, sealed.integrityHash, "the sealed receipt itself is what is shown");
    assert.deepEqual(await setup.state.findOperation(prepared.operation_id), stored);
    assert.deepEqual(await setup.state.loadReceipt(stored.profileHash, stored.operationId), sealed);
  });
}
