import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { address as solanaAddress } from "@solana/kit";
import { TronWeb } from "tronweb";
import { getAddress } from "viem";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const defaultBase = join(repo, "data/allowlist/2026-09-17");
const noRails = { direct: false, gasless: false, x402: false, bridge: false, swap: false };
const canonicalMarketRequest = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&sparkline=false&price_change_percentage=24h&locale=en&precision=full";
const expectedNatives = [
  ["eip155:1", "evm", "ETH", 18, "top_10"],
  ["eip155:8453", "evm", "ETH", 18, "top_10"],
  ["eip155:42161", "evm", "ETH", 18, "top_10"],
  ["eip155:10", "evm", "ETH", 18, "top_10"],
  ["eip155:137", "evm", "POL", 18, "native_additional"],
  ["eip155:56", "evm", "BNB", 18, "top_10"],
  ["eip155:43114", "evm", "AVAX", 18, "native_additional"],
  ["eip155:130", "evm", "ETH", 18, "top_10"],
  ["eip155:59144", "evm", "ETH", 18, "top_10"],
  ["eip155:143", "evm", "MON", 18, "native_additional"],
  ["eip155:1329", "evm", "SEI", 18, "native_additional"],
  ["tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc", "tron", "TRX", 6, "top_10"],
  ["solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", "solana", "SOL", 9, "top_10"],
];
const expectedDeployments = [
  "USDC:eip155:1:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "USDT:eip155:1:0xdAC17F958D2ee523a2206206994597C13D831ec7",
  "USDC:eip155:8453:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "USDC:eip155:42161:0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  "USDC:eip155:10:0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  "USDC:eip155:137:0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  "USDC:eip155:43114:0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
  "USDT:eip155:43114:0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7",
  "USDC:eip155:130:0x078D782b760474a361dDA0AF3839290b0EF57AD6",
  "USDC:eip155:59144:0x176211869cA2b568f2A7D4EE941E073a821EE1ff",
  "USDC:eip155:143:0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
  "USDC:eip155:1329:0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392",
  "USDT:tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
  "USDC:solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "USDT:solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d:Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
].sort();

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const sorted = (values) => [...values].sort();
const filesRecursively = (root) => readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
  const path = join(root, entry.name);
  return entry.isDirectory() ? filesRecursively(path) : [path];
});

export function validateAllowlistDataset(base = defaultBase, datasetOverride) {
  const readJson = (path) => JSON.parse(readFileSync(join(base, path), "utf8"));
  const dataset = datasetOverride ?? readJson("dataset.json");
  const market = readJson(dataset.selection.responsePath);

  assert.equal(dataset.schemaVersion, "apn.asset-policy-candidate-dataset.v1");
  assert.equal(dataset.datasetVersion, "2026-09-17.market-cap-top-10.1");
  assert.equal(dataset.retrievedAt.slice(0, 10), "2026-09-17");
  assert.equal(dataset.selection.requestUrl, canonicalMarketRequest);
  assert.equal(readFileSync(join(base, "raw/coingecko/request-url.txt"), "utf8").trim(), canonicalMarketRequest);
  assert.equal(dataset.selection.ranking, "global circulating market capitalization descending");
  assert.equal(dataset.selection.candidateCount, 10);
  assert.equal(dataset.selection.includeRehypothecated, false);
  assert.equal(dataset.selection.candidateSemantics, "The ranked candidate set is exactly the frozen CoinGecko top 10; no native additions alter or extend those ten ranks.");
  assert.equal(dataset.selection.chainProjectionSemantics, "Each named target network has one native gas-asset row. top_10 means that native asset is one of the ranked ten; native_additional is required network inventory only and is not an added market-ranked candidate.");
  assert.equal(dataset.assetPolicyRegistryCompatibility.targetSchemaVersion, "apn.asset-policy-registry.v1");
  assert.equal(dataset.assetPolicyRegistryCompatibility.status, "blocked_owner_caps_missing");
  assert.equal(sha256(join(base, dataset.selection.responsePath)), dataset.selection.responseSha256);
  assert.equal(sha256(join(base, dataset.selection.platformMetadataResponsePath)), dataset.selection.platformMetadataResponseSha256);

  const platformExtract = readJson(dataset.selection.platformMetadataExtractPath);
  assert.deepEqual(new Set(platformExtract.map((row) => row.id)), new Set(dataset.rankedCandidates.map((row) => row.coinGeckoId)));
  assert.equal(dataset.rankedCandidates.length, 10);
  assert.equal(market.length, 10);
  assert.deepEqual(dataset.rankedCandidates.map(({ rank, coinGeckoId, symbol, name, marketCapUsd, lastUpdated }) =>
    ({ rank, coinGeckoId, symbol, name, marketCapUsd, lastUpdated })), market.map((row) => ({
    rank: row.market_cap_rank, coinGeckoId: row.id, symbol: row.symbol.toUpperCase(), name: row.name,
    marketCapUsd: row.market_cap, lastUpdated: row.last_updated,
  })));
  assert.deepEqual(market.map((row) => row.market_cap_rank), Array.from({ length: 10 }, (_, index) => index + 1));
  assert.deepEqual(market.map((row) => row.market_cap), [...market].map((row) => row.market_cap).sort((a, b) => b - a));
  assert.equal(new Set(dataset.rankedCandidates.map((row) => row.coinGeckoId)).size, 10);
  for (const row of dataset.rankedCandidates) {
    const extracted = platformExtract.find((entry) => entry.id === row.coinGeckoId);
    assert.deepEqual(row.platformMetadata.platforms, extracted.platforms);
  }
  const figure = dataset.rankedCandidates.find((row) => row.coinGeckoId === "figure-heloc");
  assert.deepEqual(figure.platformMetadata.platforms, { provenance: "scope1qrm5d0wjzamyywvjuws6774ljmrqu8kh9x" });
  assert.equal(figure.disposition, "refused_no_target_native_or_verified_issuer_deployment");

  assert.deepEqual(dataset.chains.map((chain) => [chain.chain, chain.family, chain.native.symbol,
    chain.native.decimals, chain.native.selectionClass]), expectedNatives);
  const chainIds = new Set(dataset.chains.map((row) => row.chain));
  assert.equal(chainIds.size, dataset.chains.length);
  const chainDeployments = [];
  for (const chain of dataset.chains) {
    assert.deepEqual(chain.native.rails, noRails);
    assert.equal(chain.native.kind, "native");
    assert.equal(chain.native.identifier, null);
    assert.equal(chain.native.caps, null);
    const identity = readJson(chain.native.evidence.chainIdentityResponse);
    if (chain.family === "evm") assert.equal(`eip155:${BigInt(identity.result).toString()}`, chain.chain);
    else if (chain.family === "solana") assert.equal(`solana:${identity.result}`, chain.chain);
    else assert.equal(`tron:${identity.blockID}`, chain.chain);

    const identities = new Set(["native"]);
    for (const token of chain.verifiedTokenDeployments) {
      assert.deepEqual(token.rails, noRails);
      assert.equal(token.caps, null);
      assert.equal(token.eligibility, "issuer_native");
      if (chain.family === "evm") assert.equal(getAddress(token.identifier), token.identifier);
      else if (chain.family === "solana") assert.equal(solanaAddress(token.identifier), token.identifier);
      else assert.equal(TronWeb.address.fromHex(TronWeb.address.toHex(token.identifier)), token.identifier);
      assert.equal(identities.has(token.identifier), false, `duplicate ${chain.chain}:${token.identifier}`);
      identities.add(token.identifier);
      const request = readJson(token.evidence.decimalsRequest);
      if (chain.family === "evm") {
        assert.equal(request.method, "eth_call");
        assert.equal(getAddress(request.params[0].to), token.identifier);
        assert.equal(request.params[0].data, "0x313ce567");
        assert.equal(request.params[1], "latest");
      } else if (chain.family === "solana") {
        assert.equal(request.method, "getTokenSupply");
        assert.deepEqual(request.params, [token.identifier, { commitment: "finalized" }]);
      } else {
        assert.equal(request.contract_address, TronWeb.address.toHex(token.identifier).toLowerCase());
        assert.equal(request.function_selector, "decimals()");
        assert.equal(request.visible, false);
      }
      const response = readJson(token.evidence.decimalsResponse);
      const decimals = chain.family === "evm" ? Number(BigInt(response.result)) :
        chain.family === "solana" ? response.result.value.decimals : Number(BigInt(`0x${response.constant_result[0]}`));
      assert.equal(decimals, token.decimals);
      chainDeployments.push(`${token.symbol}:${chain.chain}:${token.identifier}`);
    }
  }
  assert.deepEqual(sorted(chainDeployments), expectedDeployments);

  const candidateDeployments = dataset.rankedCandidates.flatMap((row) => row.verifiedDeployments.map((deployment) =>
    `${row.symbol}:${deployment.chain}:${deployment.identifier}`));
  assert.deepEqual(sorted(candidateDeployments), expectedDeployments);
  const topTenNativeProjection = dataset.chains.filter((chain) => chain.native.selectionClass === "top_10")
    .map((chain) => `${chain.native.symbol}:${chain.chain}`);
  const candidateNativeProjection = dataset.rankedCandidates.flatMap((row) => row.nativeChains.map((chain) => `${row.symbol}:${chain}`));
  assert.deepEqual(sorted(candidateNativeProjection), sorted(topTenNativeProjection));

  const refusalKeys = new Set(dataset.explicitRefusals.map((row) => `${row.asset}:${row.chain ?? "*"}`));
  for (const key of ["BTC:*", "XRP:*", "FIGR_HELOC:*", "ZEC:*", "USDC:eip155:56", "USDC:tron:00000000000000001ebf88508a03865c71d452e25f4d51194196a1d22b6653dc", "USDT:eip155:56"]) {
    assert.equal(refusalKeys.has(key), true, `missing explicit refusal ${key}`);
  }
  for (const refusal of dataset.explicitRefusals) assert.match(refusal.reason, /refus|not list|not substitut|unverified|no .*verified|discontinued/i);

  const manifestPath = join(base, "raw/SHA256SUMS");
  const manifested = [];
  for (const line of readFileSync(manifestPath, "utf8").trim().split("\n")) {
    const [expected, path] = line.split(/\s+/, 2);
    assert.equal(sha256(join(base, path)), expected, path);
    manifested.push(path);
  }
  const rawEvidence = filesRecursively(join(base, "raw")).map((path) => relative(base, path))
    .filter((path) => !path.endsWith("SHA256SUMS"));
  assert.deepEqual(sorted(manifested), sorted(rawEvidence));
  return { candidates: dataset.rankedCandidates.length, chains: dataset.chains.length, deployments: chainDeployments.length };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = validateAllowlistDataset();
  console.log(`validated ${result.candidates} candidates, ${result.chains} chains, ${result.deployments} verified token deployments`);
}
