import assert from "node:assert/strict";
import test from "node:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { runCli } from "../../src/cli.js";
import type { OutputEnvelope } from "../../src/commands.js";
import { createMcpServer, type McpRuntimeOptions } from "../../src/mcp-server.js";
import { profilePolicyApprovalPhrase, TtyProfilePolicyApproval, type ProfilePolicyApprovalIntent,
  type ProfilePolicyApprovalPort } from "../../src/policy-approval.js";
import { assertUnattendedX402Balance, type ProfilePolicyRecord } from "../../src/profile-policy.js";
import { EvmTestRpc } from "./evm-helpers.js";
import { TestNative, temporaryState } from "./helpers.js";

/**
 * QA 0.5.54 X402-BALANCE-IGNORES-CUSTOM-POLICY-054-001 and X402-POLICY-NATIVE-CURRENCY-LABEL-054-001: an owner policy for
 * Sei (eip155:1329) USDC 0xe15f…2392 with a 1000-atom balance cap and a 0.35 SEI native cap. The wallet held 8095 atoms;
 * `wallet balance` (CLI and MCP) said no limit was configured while x402 prepare refused as overfunded, and the consent
 * screen named the native cap in ETH.
 */
const SEI_USDC = "0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392", ETHEREUM_USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const POLYGON_USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", POLYGON_USDT = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
const WRAPPING = { load: async () => Buffer.alloc(32, 61), create: async () => Buffer.alloc(32, 61) };
const REDUCE = "Reduce excess manually only to an independently verified address; APN does not sweep or refund automatically.";
const HELP = "apn pay transfer prepare-asset --help";
class Recording implements ProfilePolicyApprovalPort {
  readonly intents: ProfilePolicyApprovalIntent[] = [];
  async approve(intent: ProfilePolicyApprovalIntent): Promise<void> { this.intents.push(intent); }
}

async function owner(t: { after(fn: () => Promise<void>): void }) {
  const temporary = await temporaryState(); t.after(temporary.cleanup);
  const native = new TestNative(), approval = new Recording(), base = { stateRoot: temporary.root, wrappingSecret: WRAPPING, native };
  assert.equal((await runCli(["wallet", "ensure"], {}, base)).ok, true);
  const policy = async (chain: string, asset: string, balance: string, nativeWei?: string) => {
    const set = await runCli(["wallet", "policy", "set", "--profile", "default", "--chain", chain, "--asset", asset, "--max-balance-usdc-atomic", balance,
      "--max-x402-amount-atomic", "1000", ...(nativeWei === undefined ? [] : ["--max-balance-eth-wei", nativeWei])], {}, { ...base, policyApproval: approval });
    assert.equal(set.ok, true, JSON.stringify(set.error));
  };
  const balance = async (chainId: number, asset: string, assetAtomic: string, nativeAtomic = "332924917493149312") => {
    const rpc = new EvmTestRpc(); rpc.chainId = chainId; rpc.assetAtomic = assetAtomic; rpc.nativeAtomic = nativeAtomic;
    const options: McpRuntimeOptions = { ...base, rpc }, chain = `eip155:${chainId}`;
    const cli = await runCli(["wallet", "balance", "--profile", "default", "--chain", chain, "--asset", asset, "--rpc-url", "https://rpc.example"], {}, options);
    const server = createMcpServer(options), pair = InMemoryTransport.createLinkedPair(); await server.connect(pair[1]);
    const client = new Client({ name: "qa0554-balance", version: "1" }); await client.connect(pair[0]);
    try {
      const content = (await client.callTool({ name: "apn_wallet_balance", arguments: { profile: "default", chain, asset, rpc_url: "https://rpc.example" } })).content[0];
      const mcp = JSON.parse(content?.type === "text" ? content.text : "{}") as OutputEnvelope;
      // Each read stamps its own observation time; everything else, the policy verdict included, is the same envelope.
      const stable = (envelope: OutputEnvelope) => { const data = envelope.data as { provenance?: Record<string, unknown> } | null;
        return { ...envelope, request_id: null, data: data === null ? null : { ...data, provenance: { ...data.provenance, observed_at: null } } }; };
      assert.deepEqual(stable(mcp), stable(cli), "CLI and MCP read the same policy");
    } finally { await client.close(); await server.close(); }
    assert.equal(cli.ok, true, JSON.stringify(cli.error));
    return cli.data as { funding_posture: { classification: string; asset_limit_atomic: string | null }; funding_guidance: { action: string }; next_actions: string[] };
  };
  return { approval, policy, balance };
}

test("a Sei USDC policy is read by its exact chain and token: 8095 atoms above its 1000 cap are overfunded, as x402 payment refuses", async (t) => {
  const { approval, policy, balance } = await owner(t);
  await policy("eip155:1329", SEI_USDC, "1000", "350000000000000000");
  assert.deepEqual(approval.intents[0]?.x402Network, { chainId: 1329, token: SEI_USDC });
  const read = await balance(1329, SEI_USDC, "8095");
  assert.deepEqual(read.funding_posture, { classification: "overfunded", asset_limit_atomic: "1000", generic_unattended_permission_implied: false,
    inbound_balance_capped_by_apn: false });
  assert.equal(read.funding_guidance.action, "Do not add the selected USDC on eip155:1329: the balance exceeds the owner limit of 1000 atomic units by " +
    "7095 atomic units (0.007095 USDC); new unattended x402 with this token on this network is blocked until the owner reduces the excess manually. " +
    "Fund native SEI on eip155:1329 for gas manually with a small amount only: at most 17075082506850688 wei (0.017075082506850688 SEI) more keeps " +
    "it within the owner limit of 350000000000000000 wei.");
  assert.deepEqual(read.next_actions, [REDUCE, HELP]);
  assert.doesNotMatch(JSON.stringify(read), /no owner .*limit is configured|Fund the selected/u);
  // The payment gate on the same record refuses for the same reason.
  const record = { maxBalanceUsdcAtomic: "1000", maxX402AmountAtomic: "1000" } as ProfilePolicyRecord;
  assert.throws(() => assertUnattendedX402Balance(record, "8095"), { code: "APN_WALLET_OVERFUNDED_FOR_UNATTENDED_X402" });
  // Within the cap: the remaining room in the token's own unit.
  assert.equal((await balance(1329, SEI_USDC, "400")).funding_posture.classification, "within_limit");
});

test("no policy or network fallback: each token answers only to its own chain+token policy", async (t) => {
  const { policy, balance } = await owner(t);
  await policy("eip155:1", ETHEREUM_USDT, "5000");
  await policy("eip155:137", POLYGON_USDC, "5000", "1000");
  // A non-default token on a legacy network: its own policy, not the network's released USDC one.
  const usdt = await balance(1, ETHEREUM_USDT, "6000");
  assert.deepEqual([usdt.funding_posture.classification, usdt.funding_posture.asset_limit_atomic], ["overfunded", "5000"]);
  assert.match(usdt.funding_guidance.action, /^Do not add the selected USDT on eip155:1: the balance exceeds the owner limit of 5000 atomic units/u);
  // Another Polygon token (not in APN's token list) borrows nothing from the Polygon USDC policy (neither its token cap nor its native cap).
  const other = await balance(137, POLYGON_USDT, "6000", "5000");
  assert.deepEqual([other.funding_posture.classification, other.funding_posture.asset_limit_atomic], ["unassessed", null]);
  assert.match(other.funding_guidance.action, /^Fund the selected token on eip155:137 manually with a small amount only; no owner balance limit is configured\. Fund native POL on eip155:137 for gas .*no owner POL balance limit is configured\.$/u);
  // Native gas on a network with no implied token: its cap lives in each token's policy, never claimed absent.
  const gas = await balance(137, "native", "0", "5000");
  assert.deepEqual([gas.funding_posture.classification, gas.funding_guidance.action], ["unassessed", "Fund native POL on eip155:137 for gas manually " +
    "with a small amount only; its owner limit lives in each token's x402 policy on this network, so read it with apn wallet balance --asset set to that token."]);
  const monad = await balance(143, "native", "0", "5000");
  assert.match(monad.funding_guidance.action, /^Fund native MON on eip155:143 .*each token's x402 policy/u);
});

async function consent(intent: Partial<ProfilePolicyApprovalIntent>): Promise<string> {
  let screen = "";
  const full = { profile: "default", walletAddress: "0x1111111111111111111111111111111111111111" as const, fingerprint: "a".repeat(64),
    change: "create" as const, maxBalanceUsdcAtomic: "20000", maxX402AmountAtomic: "1000", ...intent };
  await new TtyProfilePolicyApproval({ isTerminal: () => true, openTerminal: async () => ({ fd: 1, write: async (text: string) => { screen += text; },
    read: async function* () { yield Buffer.from(`${profilePolicyApprovalPhrase(full.fingerprint)}\n`); }, close: async () => undefined }) }).approve(full);
  return screen;
}

test("the policy consent names the native cap in the chain's own currency, a neutral label for an unknown chain, and none for Solana", async () => {
  const cap = { maxBalanceEthWei: "350000000000000000" };
  for (const [chainId, line] of [[undefined, "Maximum wallet ETH: 350000000000000000 wei (0.35 ETH, 18 decimals)"],
    [1, "Maximum wallet ETH: 350000000000000000 wei (0.35 ETH, 18 decimals)"], [1329, "Maximum wallet SEI: 350000000000000000 wei (0.35 SEI, 18 decimals)"],
    [137, "Maximum wallet POL: 350000000000000000 wei (0.35 POL, 18 decimals)"], [56, "Maximum wallet BNB: 350000000000000000 wei (0.35 BNB, 18 decimals)"],
    [4242, "Maximum wallet native coin of chain 4242: 350000000000000000 wei (base units)"]] as const) {
    const screen = await consent({ ...cap, ...(chainId === undefined ? {} : { x402Network: { chainId, token: SEI_USDC } }) });
    assert.ok(screen.includes(`\n${line}\n`), `${chainId}: ${screen}`);
    if (chainId !== undefined && chainId !== 1) assert.doesNotMatch(screen, /\bETH\b/u);
  }
  assert.ok((await consent({ x402Network: { chainId: 1329, token: SEI_USDC } })).includes("\nMaximum wallet SEI: not configured\n"));
  const solana = await consent({ x402Solana: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" } });
  assert.doesNotMatch(solana, /Maximum wallet (?:ETH|native)|\bwei\b/u);
});
