import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { keccak256, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { runCli } from "../../src/cli.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { EncryptedWalletStore } from "../../src/encrypted-wallet-store.js";
import { createMcpServer } from "../../src/mcp-server.js";
import { ApnError } from "../../src/errors.js";
import { OperationIndex } from "../../src/operation-index/index.js";
import { SecureStateStore } from "../../src/secure-state-store.js";
import { StateStore } from "../../src/state.js";
import type { TtyTransferApprovalOptions } from "../../src/tty-approval.js";
import { ETHEREUM_USDT } from "../../src/swap/uniswap-v3/pins.js";
import { UNISWAP_V3_SWAP_ROUTER } from "../../src/swap/uniswap-v3/token-route.js";
import { sendRefusedBeforeTransport } from "../../src/wallet-allowance/chain.js";
import { WALLET_ALLOWANCE_REVOKE_JOURNAL_MAX } from "../../src/wallet-allowance/model.js";
import { WalletAllowanceRevokeRepository } from "../../src/wallet-allowance/repository.js";
import { walletAllowanceResendCommand } from "../../src/wallet-allowance/view.js";
import { temporaryState } from "./helpers.js";
import { movingNode, typingTerminal, WRAPPING } from "./uniswap-token-qa0552-harness.js";
import { allowanceRpc } from "./wallet-allowance-helpers.js";

const KEY = `0x${"0".repeat(63)}9` as Hex, ACCOUNT = privateKeyToAccount(KEY).address, PROFILE = "qa0554-revoke";
const OTHER_SPENDER = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
const revokeArgv = (spender: string) => ["wallet", "allowance", "revoke", "--profile", PROFILE, "--chain", "eip155:1", "--token", ETHEREUM_USDT, "--spender", spender,
  "--max-gas-limit", "60000", "--max-fee-per-gas-wei", "2000000000", "--max-priority-fee-per-gas-wei", "1000000"];
const NO_TERMINAL: TtyTransferApprovalOptions = { openTerminal: async () => { throw new Error("no terminal"); } };
type Rpc = ReturnType<typeof allowanceRpc>;

async function wallet(root: string) {
  const state = new StateStore(root); await state.initialize(); await new EncryptedWalletStore(state, WRAPPING).importNew(PROFILE, KEY, ACCOUNT);
  return { chain: movingNode({ account: ACCOUNT, allowance: "10000", pending: 10n }), records: new WalletAllowanceRevokeRepository(root) };
}
const options = (root: string, rpc: () => Rpc, tty: TtyTransferApprovalOptions, clock: () => Date = () => new Date()) =>
  ({ stateRoot: root, wrappingSecret: WRAPPING, clock: { now: clock }, walletAllowanceRpc: rpc, walletAllowanceTtyOptions: tty, finalizedRead: rpc });
function cli(root: string, rpc: () => Rpc, tty: TtyTransferApprovalOptions, clock?: () => Date) {
  return async (argv: readonly string[]): Promise<OutputEnvelope> => await runCli([...argv], process.env, options(root, rpc, tty, clock));
}
const onlyRecord = (root: string) => readdirSync(`${root}/wallet-allowance-revokes`).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, 64));

test("an unconsented revoke stops holding the wallet's chain once its window and the unstarted margin pass; another revoke is then admitted", async (t) => {
  // Within its window an unconsented (no TTY) revoke holds eip155:1 for the wallet: another revoke of it is refused, naming it.
  const fresh = await temporaryState(); t.after(fresh.cleanup); const f = await wallet(fresh.root);
  let out = await cli(fresh.root, () => allowanceRpc(f.chain), NO_TERMINAL)(revokeArgv(UNISWAP_V3_SWAP_ROUTER));
  assert.deepEqual([out.ok, out.error?.details?.nativeCode], [false, "APN_TTY_UNAVAILABLE"]); const [held] = onlyRecord(fresh.root);
  assert.equal((await f.records.required(held!)).state, "prepared");
  out = await cli(fresh.root, () => allowanceRpc(f.chain), typingTerminal().tty)(revokeArgv(OTHER_SPENDER));
  assert.deepEqual([out.error?.code, out.error?.details?.blockingOperationId, f.chain.node.sends.length], ["APN_OPERATION_BLOCKED", held, 0]);

  // The same unconsented revoke run 20 minutes ago: its 240 s window plus the 10 min margin has passed, so it holds nothing.
  const past = await temporaryState(); t.after(past.cleanup); const p = await wallet(past.root);
  out = await cli(past.root, () => allowanceRpc(p.chain), NO_TERMINAL, () => new Date(Date.now() - 20 * 60_000))(revokeArgv(UNISWAP_V3_SWAP_ROUTER));
  assert.deepEqual([out.ok, out.error?.details?.nativeCode], [false, "APN_APPROVAL_EXPIRED"]); const [expired] = onlyRecord(past.root);
  assert.equal((await p.records.required(expired!)).state, "prepared", "never signed, never consented");
  const terminal = typingTerminal();
  out = await cli(past.root, () => allowanceRpc(p.chain), terminal.tty)(revokeArgv(OTHER_SPENDER));
  assert.equal(out.ok, true, JSON.stringify(out.error));
  assert.deepEqual([(out.data as { state: string }).state, p.chain.node.sends.length], ["submitted", 1], "the other revoke is admitted and sent once");
  const entry = await new OperationIndex(new SecureStateStore(past.root)).find(expired!);
  assert.deepEqual([entry?.state, entry?.claims], ["terminal", []]);
  out = await cli(past.root, () => allowanceRpc(p.chain), NO_TERMINAL)(["operation", "status", "--operation", expired!]);
  assert.deepEqual([(out.data as { state: string }).state, (await p.records.required(expired!)).journal.at(-1)?.reason],
    ["failed_before_effect", "consent_window_expired_unsigned"]);
});

test("a send the RPC refuses before transport leaves the revoke signed: the same command later sends the same bytes once", async (t) => {
  for (const kind of ["cooldown_before_marker", "http_429_at_send"] as const) {
    const temporary = await temporaryState(); t.after(temporary.cleanup); const { chain, records } = await wallet(temporary.root), terminal = typingTerminal();
    let refusing = true;
    const rpc = () => { const base = allowanceRpc(chain); return { ...base,
      checkSend: async () => { if (refusing && kind === "cooldown_before_marker") throw new ApnError("APN_PROVIDER_UNAVAILABLE", "RPC provider is cooling down.", { reason: "rpc_provider_cooldown" }); },
      send: async (raw: Hex) => { if (refusing && kind === "http_429_at_send") throw new ApnError("APN_RPC_RATE_LIMITED", "The direct EVM RPC provider requested a cooldown.", { httpStatus: 429 });
        return await base.send(raw); } }; };
    const run = cli(temporary.root, rpc, terminal.tty);
    let out = await run(revokeArgv(UNISWAP_V3_SWAP_ROUTER)); const [id] = onlyRecord(temporary.root), refused = await records.required(id!);
    const resend = walletAllowanceResendCommand(refused);
    assert.deepEqual([out.ok, out.error?.code, out.error?.details?.state, out.next_actions, chain.node.sends.length],
      [false, kind === "cooldown_before_marker" ? "APN_PROVIDER_UNAVAILABLE" : "APN_RPC_RATE_LIMITED", "signed", [resend], 0], kind);
    assert.equal(resend, `apn ${revokeArgv(UNISWAP_V3_SWAP_ROUTER).join(" ")}`, "the exact command with the frozen caps");
    assert.deepEqual(refused.journal.map((entry) => `${entry.state}:${entry.reason}`), kind === "cooldown_before_marker"
      ? ["prepared:prepared_and_frozen", "signed:owner_approved_and_sealed"]
      : ["prepared:prepared_and_frozen", "signed:owner_approved_and_sealed", "submitted:single_send_started", "signed:send_refused_before_transport"]);
    assert.equal(refused.submittedAt === null, kind === "cooldown_before_marker");
    out = await run(["operation", "status", "--operation", id!]);
    assert.deepEqual([(out.data as { state: string }).state, out.next_actions], ["signed", [resend, `apn operation abandon --operation ${id}`]]);
    const server = createMcpServer(options(temporary.root, rpc, terminal.tty)), pair = InMemoryTransport.createLinkedPair(); await server.connect(pair[1]);
    const client = new Client({ name: "qa0554-revoke", version: "1" }); await client.connect(pair[0]); t.after(async () => { await client.close(); await server.close(); });
    const mcp = (await client.callTool({ name: "apn_operation_status", arguments: { operation: id } })).structuredContent as unknown as OutputEnvelope;
    assert.deepEqual([mcp.data, mcp.next_actions], [out.data, out.next_actions], "MCP status shows the same signed revoke and the same exits");

    refusing = false; const screens = terminal.screens.length;
    out = await run(resend.split(" ").slice(1)); assert.equal(out.ok, true, JSON.stringify(out.error));
    const sent = await records.required(id!);
    assert.deepEqual([(out.data as { operation_id: string }).operation_id, sent.state, chain.node.sends.length, terminal.screens.length], [id, "submitted", 1, screens],
      "the open revoke continues: no new operation, no second consent or signature");
    assert.deepEqual([chain.node.sends[0], keccak256(chain.node.sends[0]!)], [refused.signed!.rawTransaction, refused.signed!.transactionHash]);
    if (refused.submittedAt !== null) assert.equal(sent.submittedAt, refused.submittedAt, "the first start's time is kept");
    chain.land(chain.node.sends[0]!, chain.node.head - 5n); chain.node.allowance = "0";
    out = await run(["operation", "status", "--operation", id!]);
    assert.deepEqual([(out.data as { state: string }).state, chain.node.sends.length], ["completed", 1]);
  }
});

test("refused sends go back to signed only while a restart and an exit fit the journal; a 429 forwarded anyway still completes from signed", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup); const { chain, records } = await wallet(temporary.root);
  const limited = () => ({ ...allowanceRpc(chain), send: async () => { throw new ApnError("APN_RPC_RATE_LIMITED", "Rate limited.", { httpStatus: 429 }); } });
  const run = cli(temporary.root, limited, typingTerminal().tty);
  let out = await run(revokeArgv(UNISWAP_V3_SWAP_ROUTER)); const [id] = onlyRecord(temporary.root);
  // The provider forwarded the refused send after all: status finds its receipt and completes the revoke from signed.
  const record = await records.required(id!); assert.equal(record.state, "signed");
  chain.land(record.signed!.rawTransaction as Hex, chain.node.head - 5n); chain.node.allowance = "0";
  out = await run(["operation", "status", "--operation", id!]);
  assert.deepEqual([(out.data as { state: string }).state, chain.node.sends.length], ["completed", 0]);

  const second = await temporaryState(); t.after(second.cleanup); const s = await wallet(second.root), again = cli(second.root, () => ({ ...allowanceRpc(s.chain),
    send: async () => { throw new ApnError("APN_RPC_RATE_LIMITED", "Rate limited.", { httpStatus: 429 }); } }), typingTerminal().tty);
  const states: string[] = [];
  for (let round = 0; round < 7; round += 1) { out = await again(revokeArgv(UNISWAP_V3_SWAP_ROUTER)); states.push(out.ok ? (out.data as { state: string }).state : out.error!.code); }
  const [kept] = onlyRecord(second.root), last = await s.records.required(kept!);
  assert.deepEqual(states, [...Array(6).fill("APN_RPC_RATE_LIMITED"), "submitted"]);
  assert.deepEqual([last.state, last.journal.length, WALLET_ALLOWANCE_REVOKE_JOURNAL_MAX, s.chain.node.sends.length], ["submitted", 15, 16, 0],
    "the seventh refusal stays submitted: observation, the never-lands proof or the owner's abandon decide");
  out = await again(revokeArgv(UNISWAP_V3_SWAP_ROUTER));
  assert.deepEqual([(out.data as { state: string }).state, (await s.records.required(kept!)).journal.length], ["submitted", 15], "a submitted revoke is only observed");
});

test("only the send's own pre-transport refusals count as nothing sent", () => {
  const refused = [new ApnError("APN_RPC_BUDGET_EXCEEDED", "cap", { physicalRequests: 24, maxPhysicalRequests: 24 }),
    new ApnError("APN_PROVIDER_UNAVAILABLE", "cooling", { reason: "rpc_provider_cooldown" }), new ApnError("APN_RPC_RATE_LIMITED", "429", { httpStatus: 429 }),
    new ApnError("APN_RPC_PROTOCOL", "429", { rpcMethod: "eth_sendRawTransaction", httpStatus: 429 })];
  const unclear = [new ApnError("APN_RPC_AMBIGUOUS", "Transaction submission outcome is ambiguous."),
    new ApnError("APN_RPC_BUDGET_EXCEEDED", "deadline", { reason: "wall_deadline" }), new ApnError("APN_PROVIDER_UNAVAILABLE", "other"),
    new ApnError("APN_RPC_PROTOCOL", "500", { httpStatus: 500 })];
  assert.deepEqual([...refused, ...unclear].map(sendRefusedBeforeTransport), [true, true, true, true, false, false, false, false]);
});
