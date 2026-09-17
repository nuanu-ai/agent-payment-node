import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { address as solanaAddress } from "@solana/kit";
import { TronWeb } from "tronweb";
import { getAddress } from "viem";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = join(repo, "data/allowlist/2026-09-17");
const readJson = (path) => JSON.parse(readFileSync(join(base, path), "utf8"));
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const dataset = readJson("dataset.json");
const market = readJson(dataset.selection.responsePath);

assert.equal(dataset.schemaVersion, "apn.asset-policy-candidate-dataset.v1");
assert.equal(dataset.selection.includeRehypothecated, false);
assert.equal(dataset.assetPolicyRegistryCompatibility.targetSchemaVersion, "apn.asset-policy-registry.v1");
assert.equal(dataset.assetPolicyRegistryCompatibility.status, "blocked_owner_caps_missing");
assert.equal(sha256(join(base, dataset.selection.responsePath)), dataset.selection.responseSha256);
assert.equal(sha256(join(base, dataset.selection.platformMetadataResponsePath)), dataset.selection.platformMetadataResponseSha256);
const platformExtract = readJson(dataset.selection.platformMetadataExtractPath);
assert.deepEqual(new Set(platformExtract.map((row) => row.id)), new Set(dataset.rankedCandidates.map((row) => row.coinGeckoId)));
assert.equal(dataset.rankedCandidates.length, 10);
assert.equal(market.length, 10);
assert.deepEqual(dataset.rankedCandidates.map(({ rank, coinGeckoId, symbol, lastUpdated }) =>
  ({ rank, coinGeckoId, symbol, lastUpdated })), market.map((row) => ({
    rank: row.market_cap_rank, coinGeckoId: row.id, symbol: row.symbol.toUpperCase(), lastUpdated: row.last_updated,
  })));
assert.equal(new Set(dataset.rankedCandidates.map((row) => row.coinGeckoId)).size, 10);
assert.equal(new Set(dataset.rankedCandidates.map((row) => row.rank)).size, 10);
for (const row of dataset.rankedCandidates) {
  const extracted = platformExtract.find((entry) => entry.id === row.coinGeckoId);
  assert.deepEqual(row.platformMetadata.platforms, extracted.platforms);
}
assert.equal(new Set(dataset.chains.map((row) => row.chain)).size, dataset.chains.length);

const noRails = { direct: false, gasless: false, x402: false, bridge: false, swap: false };
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
    else {
      assert.equal(TronWeb.address.fromHex(TronWeb.address.toHex(token.identifier)), token.identifier);
    }
    assert.equal(identities.has(token.identifier), false, `duplicate ${chain.chain}:${token.identifier}`);
    identities.add(token.identifier);
    const response = readJson(token.evidence.decimalsResponse);
    const decimals = chain.family === "evm" ? Number(BigInt(response.result)) :
      chain.family === "solana" ? response.result.value.decimals : Number(BigInt(`0x${response.constant_result[0]}`));
    assert.equal(decimals, token.decimals);
  }
}

const deploymentKeys = dataset.rankedCandidates.flatMap((row) => row.verifiedDeployments.map((deployment) =>
  `${row.symbol}:${deployment.chain}:${deployment.identifier}`));
assert.equal(new Set(deploymentKeys).size, deploymentKeys.length);
for (const refusal of dataset.explicitRefusals) assert.match(refusal.reason, /refus|not list|not substitut|unverified|no .*verified/i);

for (const line of readFileSync(join(base, "raw/SHA256SUMS"), "utf8").trim().split("\n")) {
  const [expected, relative] = line.split(/\s+/, 2);
  assert.equal(sha256(join(base, relative)), expected, relative);
}
console.log(`validated ${dataset.rankedCandidates.length} candidates, ${dataset.chains.length} chains, ${deploymentKeys.length} verified token deployments`);
