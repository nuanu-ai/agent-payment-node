/** The Binance-Peg Relay token-route table and its `relay prepare` binding: which routes exist, what each side's token and
 * decimals are, which options a token route requires or refuses, and that the earlier routes bind as before. */
import assert from "node:assert/strict";
import test from "node:test";
import { BINANCE_PEG_POLICY_ASSETS } from "../../src/binance-peg-policy-assets.js";
import { bindArgv } from "../../src/command-binder.js";
import { ETHEREUM_DEPOSITORY } from "../../src/relay/quote.js";
import { RELAY_TOKEN_DEPOSITORY, RELAY_TOKENS, relayTokenRouteByReference, relayTokenRouteFor, relayTokenRoutes } from "../../src/relay/token-routes.js";

const RECIPIENT = "0x1CA099Be15d7B55225317Bf10407B77f672e21f6";
const tokenArgs = (source: string, asset: string, destination: string, destinationAsset: string, extra: readonly string[] = []) => ["relay", "prepare",
  "--profile", "relay-route-qa", "--source-chain", source, "--asset", asset, "--destination-chain", destination,
  "--destination-asset", destinationAsset, "--recipient", RECIPIENT, "--amount-atomic", "5000000000000000000", "--min-output-atomic", "4800000",
  "--max-deposit-network-fee-wei", "10000000000000", "--max-approval-network-fee-wei", "10000000000000", "--idempotency-key", "relay-route-qa-0001", ...extra];

test("24 token routes: BNB USDT and USDC to every peer token, and the admissible peer sources back to both", () => {
  const routes = relayTokenRoutes();
  assert.equal(routes.length, 24);
  assert.equal(new Set(routes.map(route => route.reference)).size, 24);
  for (const route of routes) {
    assert.equal([route.source.chainId, route.destination.chainId].filter(chain => chain === 56).length, 1, route.reference);
    assert.equal(route.reference, `${route.source.relayChain}-${route.source.alias}-${route.destination.relayChain}-${route.destination.alias}-v1`);
    assert.equal(relayTokenRouteByReference(route.reference), route);
    assert.equal(route.source.source, true);
  }
  assert.equal(routes.filter(route => route.source.chainId === 56).length, 16);
  assert.deepEqual([...new Set(routes.filter(route => route.destination.chainId === 56).map(route => `${route.source.chainId}/${route.source.alias}`))].sort(),
    ["1/usdc", "1/usdt", "137/usdc", "42161/usdc"]);
  assert.equal(RELAY_TOKEN_DEPOSITORY, ETHEREUM_DEPOSITORY);
  assert.equal(relayTokenRouteByReference("ethereum-usdc-bnb-native-v1"), null);
  assert.equal(relayTokenRouteByReference("__proto__"), null);
});

test("each side keeps its own decimals: BNB rows are the reviewed Binance-Peg supplement (18), every peer token has 6", () => {
  for (const token of RELAY_TOKENS) {
    if (token.chainId !== 56) { assert.equal(token.decimals, 6, token.address); continue; }
    const reviewed = BINANCE_PEG_POLICY_ASSETS.find(asset => asset.identifier === token.address);
    assert.deepEqual([reviewed?.decimals, reviewed?.symbol.toLowerCase(), token.decimals], [18, token.alias, 18]);
  }
  const out = relayTokenRouteFor(56, "usdt", 8453, "usdc"), back = relayTokenRouteFor(42161, "usdc", 56, "usdc");
  assert.deepEqual([out?.reference, out?.source.decimals, out?.destination.decimals], ["bnb-usdt-base-usdc-v1", 18, 6]);
  assert.deepEqual([back?.reference, back?.source.decimals, back?.destination.decimals], ["arbitrum-usdc-bnb-usdc-v1", 6, 18]);
  assert.equal(out?.source.address, "0x55d398326f99059fF775485246999027B3197955");
  assert.equal(back?.destination.address, "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d");
});

test("destination-only tokens and pairs without a BNB side have no route", () => {
  for (const [source, alias] of [[8453, "usdc"], [8453, "usdt"], [137, "usdt"], [42161, "usdt"]] as const) {
    assert.equal(relayTokenRouteFor(source, alias, 56, "usdt"), null, `${source}/${alias}`);
    assert.equal(relayTokenRouteFor(56, "usdt", source, alias)?.destination.alias, alias, "still a destination");
  }
  assert.equal(relayTokenRouteFor(1, "usdc", 8453, "usdc"), null);
  assert.equal(relayTokenRouteFor(56, "usdt", 56, "usdc"), null);
  assert.equal(relayTokenRouteFor(56, "native", 137, "usdc"), null);
  assert.equal(relayTokenRouteFor(56, "usdt", 10, "usdc"), null);
});

test("--destination-asset binds a token route with its approval ceiling; every other route-only option is refused", () => {
  const bound = bindArgv(tokenArgs("eip155:56", "usdt", "eip155:8453", "usdc"));
  assert.deepEqual(bound.request, { command: "relay.token.prepare", profile: "relay-route-qa", sourceChain: "eip155:56", asset: "usdt",
    destinationChain: "eip155:8453", destinationAsset: "usdc", recipient: RECIPIENT, amountAtomic: "5000000000000000000",
    minOutputAtomic: "4800000", maxApprovalNetworkFeeWei: "10000000000000", maxDepositNetworkFeeWei: "10000000000000",
    idempotencyKey: "relay-route-qa-0001" });
  assert.equal(bindArgv(tokenArgs("eip155:1", "usdt", "eip155:56", "usdc")).request.command, "relay.token.prepare");
  const reason = (argv: readonly string[]) => { try { bindArgv(argv); return "bound"; } catch (error) { return (error as { details?: { reason?: string } }).details?.reason; } };
  assert.equal(reason(tokenArgs("eip155:56", "usdt", "eip155:8453", "usdc", ["--payer", RECIPIENT])), "relay_route_option");
  assert.equal(reason(tokenArgs("eip155:56", "usdt", "eip155:8453", "usdc", ["--quote-file", "/tmp/quote.json"])), "relay_route_option");
  const noApproval = tokenArgs("eip155:56", "usdt", "eip155:8453", "usdc").filter((_, index, all) =>
    all[index] !== "--max-approval-network-fee-wei" && all[index - 1] !== "--max-approval-network-fee-wei");
  assert.equal(reason(noApproval), "relay_route_option");
  assert.equal(reason(tokenArgs("eip155:8453", "usdc", "eip155:56", "usdt")), "relay_route_unknown");
  assert.equal(reason(tokenArgs("eip155:56", "native", "eip155:137", "usdc")), "relay_route_unknown");
  assert.equal(reason(tokenArgs("eip155:56", "usdt", "eip155:10", "usdc")), "relay_route_unknown");
  assert.equal(reason(tokenArgs("solana:56", "usdt", "eip155:8453", "usdc")), "relay_route_unknown");
});

test("without --destination-asset the earlier routes bind exactly as before", () => {
  const ethereum = bindArgv(["relay", "prepare", "--profile", "relay-route-qa", "--source-chain", "eip155:1", "--asset", "usdc",
    "--destination-chain", "eip155:56", "--recipient", RECIPIENT, "--amount-atomic", "1000000", "--min-output-atomic", "1",
    "--max-approval-network-fee-wei", "1", "--max-deposit-network-fee-wei", "1", "--idempotency-key", "relay-route-qa-0002"]);
  assert.equal(ethereum.request.command, "relay.prepare");
  const native = bindArgv(["relay", "prepare", "--profile", "relay-route-qa", "--source-chain", "eip155:56", "--asset", "native",
    "--destination-chain", "eip155:137", "--recipient", RECIPIENT, "--amount-atomic", "1", "--min-output-atomic", "1",
    "--max-deposit-network-fee-wei", "1", "--idempotency-key", "relay-route-qa-0003"]);
  assert.equal(native.request.command, "relay.native.prepare");
  assert.throws(() => bindArgv(["relay", "prepare", "--profile", "relay-route-qa", "--source-chain", "eip155:56", "--asset", "usdt",
    "--destination-chain", "eip155:8453", "--recipient", RECIPIENT, "--amount-atomic", "1", "--min-output-atomic", "1",
    "--max-approval-network-fee-wei", "1", "--max-deposit-network-fee-wei", "1", "--idempotency-key", "relay-route-qa-0004"]),
  (error: { details?: { reason?: string } }) => error.details?.reason === "relay_route_unknown", "a token source names its destination token");
});
