/**
 * QA 0.5.66 X402-SOLANA-RECOVERY-URL-QUOTING-066-003: a prepared Solana x402 payment's continue action pasted the seller
 * URL bare, so in zsh `?` failed as a glob ("no matches found") and `&` split the command before APN ran. The action now
 * renders the URL (and every other value) as one shell argument; only the `<the same key>` placeholder stays bare.
 */
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import test from "node:test";
import * as cliRuntime from "../../src/cli.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { SOLANA_USDC } from "../../src/chain-policy.js";
import { testRuntime } from "./installed-runtime.js";
import { readySolanaFixture } from "./x402-solana-helpers.js";
import { X402_URL } from "./x402-vectors.js";

const { runCli } = await testRuntime(cliRuntime, "cli.js");

for (const query of ["", "?order=redacted", "?order=redacted&lang=en", "?order=redacted%26lang%3Den"]) {
  test(`the prepared continue action survives zsh with the seller URL "${query || "(no query)"}" and pays the same operation once`, async (context) => {
    const f = await readySolanaFixture(context, runCli), get = f.seller.get.bind(f.seller);
    f.rpc.simulateError = { InstructionError: [2n, { Custom: 1n }] };
    // The seller answers for the exact URL it was asked, query included.
    f.seller.get = async (request) => { const observed = await get(request); return { ...observed, finalUrl: request.url, observedOrigin: new URL(request.url).origin,
      rawHeaderPairs: observed.rawHeaderPairs.map(([name, value]) => name.toLowerCase() !== "payment-required" ? [name, value] as const : [name,
        Buffer.from(JSON.stringify((({ resource, ...rest }) => ({ ...rest, resource: { ...resource, url: request.url } }))(JSON.parse(Buffer.from(value, "base64").toString()))))
          .toString("base64")] as const) }; };
    const key = "qa0566-quoting-0001", args = ["x402", "solana", "pay", "--profile", "default", "--url", `${X402_URL}${query}`,
      "--asset", SOLANA_USDC, "--max-amount", "20000", "--idempotency-key", key];
    const refused = await runCli(args, {}, f.options);
    const id = refused.error?.details?.operation_id as string; assert.match(id, /^[a-f0-9]{64}$/u, JSON.stringify(refused));
    const status = await runCli(["x402", "solana", "status", "--operation", id], {}, f.options);
    const action = (status.data as { next_actions: readonly string[] }).next_actions[0]!.replace("<the same key>", key);
    // Standard zsh, no user rc files; `apn` only prints the argv it was given, so nothing runs.
    const shell = spawnSync("/bin/zsh", ["-f", "-c", `apn() { printf '%s\\0' "$@"; }; ${action}`], { encoding: "utf8" });
    assert.equal(shell.status, 0, shell.stderr);
    const argv = shell.stdout.split("\0").slice(0, -1);
    assert.deepEqual(argv, args);
    f.rpc.simulateError = null;
    const paid: OutputEnvelope = await runCli(argv, {}, f.options);
    assert.equal((paid.data as { operation_id: string }).operation_id, id, JSON.stringify(paid));
    assert.equal(f.seller.calls.filter((call) => call.paymentSignature !== undefined).length, 1);
  });
}
