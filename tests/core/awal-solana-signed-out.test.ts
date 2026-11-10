import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";
import { NodeAwalProcessRunner } from "../../src/awal-process-adapter.js";
import { ChainAccountStore } from "../../src/chain-account-store.js";
import { chainAsset } from "../../src/chain-policy.js";
import { failureEnvelope } from "../../src/output.js";
import { SolanaAwalAdapter } from "../../src/solana/awal-adapter.js";
import { SolanaTestRpc, SolanaWrapping } from "./solana-helpers.js";
import { temporaryState } from "./helpers.js";

/**
 * QA on 0.5.101, repeated after 0.5.102: with no awal session, `awal balance --chain solana --json` answers exit 1 with
 * BALANCE_FETCH_FAILED (not AUTH_REQUIRED, which only `awal address` sends), so `apn wallet balance-solana` on an AWAL
 * profile still failed APN_PROVIDER_PROTOCOL with no next step. A read whose awal answer is any exact awal failure now asks
 * `awal status --json`, and only `auth.authenticated: false` there makes it APN_PROVIDER_SESSION_REQUIRED.
 */
// The display message of awal 2.12.1 AuthRequiredError; both `address` and `balance` send it when signed out.
const AWAL_AUTH_MESSAGE = "Authentication required.\n\nSign in using one of:\n  1. Email OTP:\n     npx awal auth login <your-email>\n" +
  "     npx awal auth verify <flow-id> <6-digit-code>\n\n  2. Wallet UI:\n     npx awal show";
const CONNECT = "apn wallet connect --profile awal-solana --provider coinbase-agentic-wallet";

interface Answer { readonly exitCode: number; readonly stdout: string }
/** awal 2.12.1 `cliError` under --json: formatJson (two-space indent) of the failure on stdout, then exit 1. */
const failure = (code: string): Answer => ({ exitCode: 1, stdout: `${JSON.stringify({ success: false, error: { code, message: AWAL_AUTH_MESSAGE } }, null, 2)}\n` });
const json = (body: unknown, exitCode = 0): Answer => ({ exitCode, stdout: `${JSON.stringify(body, null, 2)}\n` });
const SIGNED_OUT = json({ server: { running: true, pid: 4242 }, auth: { authenticated: false } });

/** A controlled awal stand-in run by the real runner: it answers each command as given and logs the command it was asked. */
async function awalStandIn(answers: Readonly<Record<string, Answer>>): Promise<{ script: string; calls: () => Promise<string[]>; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "apn-awal-signed-out-")), script = join(dir, "awal.cjs"), log = join(dir, "calls.log");
  await writeFile(log, "");
  await writeFile(script, `const fs=require("node:fs");const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},a[0]+"\\n");
const answers=${JSON.stringify(answers)};const answer=answers[a[0]];
if(answer===undefined)process.exit(3);process.stdout.write(answer.stdout);process.exitCode=answer.exitCode;`);
  return { script, calls: async () => (await readFile(log, "utf8")).split("\n").filter(line => line !== ""),
    cleanup: async () => await rm(dir, { recursive: true, force: true }) };
}

async function setup(t: test.TestContext, answers: (address: string) => Readonly<Record<string, Answer>>) {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const address = (await createKeyPairSignerFromPrivateKeyBytes(Buffer.alloc(32, 9))).address;
  const rpc = new SolanaTestRpc(); await rpc.bind(address);
  const signedIn = await awalStandIn({ address: json({ address, chain: "solana" }) }); t.after(signedIn.cleanup);
  const storage = new ChainAccountStore(temporary.root, new SolanaWrapping());
  const account = await new SolanaAwalAdapter(storage, rpc, new NodeAwalProcessRunner(async () => signedIn.script)).ensureAccount("awal-solana");
  const awal = await awalStandIn(answers(address)); t.after(awal.cleanup);
  return { account, awal, adapter: new SolanaAwalAdapter(storage, rpc, new NodeAwalProcessRunner(async () => awal.script)) };
}

test("a signed-out awal's BALANCE_FETCH_FAILED is a session error naming the connect handoff once awal status says signed out", async (t) => {
  const { account, awal, adapter } = await setup(t, address => ({ address: json({ address, chain: "solana" }),
    balance: failure("BALANCE_FETCH_FAILED"), status: SIGNED_OUT }));
  for (const alias of ["sol", "usdc"] as const) {
    await assert.rejects(adapter.balance(account, chainAsset("solana", alias)), (error: { code?: string }) => {
      assert.equal(error.code, "APN_PROVIDER_SESSION_REQUIRED", alias);
      assert.deepEqual(failureEnvelope("wallet.balance-solana", "request", error).next_actions, [CONNECT], alias);
      return true;
    });
  }
  assert.deepEqual(await awal.calls(), ["address", "balance", "status", "address", "balance", "status"]);
});

test("any exact awal failure from address is a session error too when awal status says signed out", async (t) => {
  const { account, awal, adapter } = await setup(t, () => ({ address: failure("ADDRESS_FETCH_FAILED"), status: SIGNED_OUT }));
  await assert.rejects(adapter.balance(account, chainAsset("solana", "usdc")), { code: "APN_PROVIDER_SESSION_REQUIRED" });
  await assert.rejects(adapter.ensureAccount("awal-solana"), { code: "APN_PROVIDER_SESSION_REQUIRED" });
  assert.deepEqual(await awal.calls(), ["address", "status", "address", "status"]);
});

test("the failure stays a protocol failure unless awal status answers exactly authenticated: false", async (t) => {
  const statuses: ReadonlyArray<readonly [string, Answer | undefined]> = [
    ["signed in", json({ server: { running: true, pid: 4242 }, auth: { authenticated: true, email: "qa@example.com" } })],
    ["status failed", json({ success: false, error: { code: "STATUS_CHECK_FAILED", message: "Error: down" } }, 1)],
    ["exit 2", json({ server: { running: true, pid: 4242 }, auth: { authenticated: false } }, 2)],
    ["string flag", json({ server: { running: true, pid: 4242 }, auth: { authenticated: "false" } })],
    ["no auth", json({ server: { running: true, pid: 4242 } })],
    ["not JSON", { exitCode: 0, stdout: "Authentication\n  Not authenticated\n" }],
    ["unknown command", undefined],
  ];
  for (const [label, status] of statuses) {
    const { account, awal, adapter } = await setup(t, address => ({ address: json({ address, chain: "solana" }),
      balance: failure("BALANCE_FETCH_FAILED"), ...(status === undefined ? {} : { status }) }));
    await assert.rejects(adapter.balance(account, chainAsset("solana", "usdc")), { code: "APN_PROVIDER_PROTOCOL" }, label);
    assert.deepEqual(await awal.calls(), ["address", "balance", "status"], label);
  }
});

test("an answer that is not an exact awal failure never asks status", async (t) => {
  for (const [label, balance] of [
    ["exit 2", { ...failure("BALANCE_FETCH_FAILED"), exitCode: 2 }],
    ["extra key", json({ success: false, error: { code: "BALANCE_FETCH_FAILED", message: AWAL_AUTH_MESSAGE }, detail: 1 }, 1)],
    ["lowercase code", json({ success: false, error: { code: "balance_fetch_failed", message: AWAL_AUTH_MESSAGE } }, 1)],
    ["wrong chain", json({ chain: "base", balances: {} })],
  ] as const) {
    const { account, awal, adapter } = await setup(t, address => ({ address: json({ address, chain: "solana" }), balance, status: SIGNED_OUT }));
    await assert.rejects(adapter.balance(account, chainAsset("solana", "usdc")), { code: "APN_PROVIDER_PROTOCOL" }, label);
    assert.deepEqual(await awal.calls(), ["address", "balance"], label);
  }
});

test("a failed send keeps its own answer: being signed out afterwards proves nothing about it, so send never asks status", async (t) => {
  const { awal, adapter } = await setup(t, () => ({ send: failure("TRANSACTION_FAILED"), status: SIGNED_OUT }));
  // submit reaches this call only past the provider fee contract, which no production build has; the rule is the call's own.
  const run = (adapter as unknown as { run(argv: readonly string[], profile: string, call: "read" | "send"): Promise<unknown> }).run
    .bind(adapter);
  await assert.rejects(run(["send", "0.000001", "x", "--chain", "solana", "--asset", "USDC", "--json"], "awal-solana", "send"),
    { code: "APN_PROVIDER_PROTOCOL" });
  assert.deepEqual(await awal.calls(), ["send"]);
});
