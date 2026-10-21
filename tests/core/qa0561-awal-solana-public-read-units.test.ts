import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";
import { NodeAwalProcessRunner } from "../../src/awal-process-adapter.js";
import { ChainAccountStore } from "../../src/chain-account-store.js";
import { chainAsset } from "../../src/chain-policy.js";
import { renderHelp } from "../../src/command-help.js";
import { SolanaAwalAdapter } from "../../src/solana/awal-adapter.js";
import { SolanaTestRpc, SolanaWrapping, SOL_RECIPIENT } from "./solana-helpers.js";
import { temporaryState } from "./helpers.js";

/** QA 0.5.61: AWAL Solana public reads keep the provider's stdout; non-EVM amounts are labelled in their own units. */
async function awalChild(address: string): Promise<{ script: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "apn-awal-solana-")), script = join(dir, "awal.cjs");
  // A controlled awal stand-in run by the real runner: it answers public JSON only.
  await writeFile(script, `const a=process.argv.slice(2);
if(a[0]==="address")process.stdout.write(JSON.stringify({address:${JSON.stringify(address)},chain:"solana"}));
else if(a[0]==="balance"){const s=a[4]==="sol"?"SOL":"USDC";process.stdout.write(JSON.stringify({chain:"solana",balances:{[s]:{raw:"1000",decimals:s==="SOL"?9:6,formatted:"x"}}}));}
else process.exit(3);`);
  return { script, cleanup: async () => await rm(dir, { recursive: true, force: true }) };
}

test("the real awal runner keeps the public Solana address and balance JSON: ensure, reuse and SOL/USDC reads succeed", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const address = (await createKeyPairSignerFromPrivateKeyBytes(Buffer.alloc(32, 9))).address;
  const child = await awalChild(address); t.after(child.cleanup);
  const rpc = new SolanaTestRpc(); await rpc.bind(address);
  const adapter = new SolanaAwalAdapter(new ChainAccountStore(temporary.root, new SolanaWrapping()), rpc,
    new NodeAwalProcessRunner(async () => child.script), undefined, () => new Date("2026-09-08T10:00:00.000Z"));
  const account = await adapter.ensureAccount("awal-solana");
  assert.deepEqual([account.address, account.provider, account.rail], [address, "coinbase-awal", "solana"]);
  assert.deepEqual(await adapter.ensureAccount("awal-solana"), account, "a second ensure reuses the same binding");
  for (const alias of ["sol", "usdc"] as const) {
    const balance = await adapter.balance(account, chainAsset("solana", alias));
    assert.equal(balance.asset.alias, alias);
  }
  // Execution stays unavailable without the provider fee/rent/debit contract, before any provider launch.
  await assert.rejects(adapter.prepare({ account, asset: chainAsset("solana", "sol"), recipient: SOL_RECIPIENT, amountAtomic: "1",
    maximumFeeAtomic: "5000", now: new Date("2026-09-08T10:00:00.000Z") }), { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
});

test("a provider answer for another chain or without the pinned fields is still refused as a protocol failure", async (t) => {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const child = await awalChild("not-a-solana-address"); t.after(child.cleanup);
  const adapter = new SolanaAwalAdapter(new ChainAccountStore(temporary.root, new SolanaWrapping()), new SolanaTestRpc(),
    new NodeAwalProcessRunner(async () => child.script));
  await assert.rejects(adapter.ensureAccount("awal-solana"), (error: { code?: string }) => error.code !== undefined && error.code !== "APN_INTERNAL");
});

test("non-EVM amounts are labelled lamports, SUN or the asset's atomic unit in usage, options and the manifest type", () => {
  const cases: Array<[readonly string[], string, string]> = [
    [["swap", "solana", "jupiter", "quote"], "--amount", "lamports"],
    [["swap", "solana", "orca", "quote"], "--amount", "atomic"],
    [["swap", "tron", "sunswap", "quote"], "--amount", "sun"],
    [["swap", "tron", "sunswap", "quote"], "--fee-limit-sun", "sun"],
    [["x402", "solana", "pay"], "--max-amount", "atomic"],
    [["relay", "prepare"], "--amount-atomic", "atomic"],
    [["relay", "prepare"], "--min-output-atomic", "atomic"],
  ];
  for (const [path, name, unit] of cases) {
    const help = renderHelp(path);
    assert.match(help, new RegExp(`${name} <${unit}>`, "u"), `${path.join(" ")} ${name}`);
    assert.doesNotMatch(help, new RegExp(`${name} <wei>`, "u"), `${path.join(" ")} ${name}`);
  }
});
