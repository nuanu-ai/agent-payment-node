import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { defaultBase, validateAllowlistDataset } from "./validate-allowlist-dataset.mjs";

const original = JSON.parse(readFileSync(`${defaultBase}/dataset.json`, "utf8"));
const rejects = (name, mutate) => test(name, () => {
  const candidate = structuredClone(original);
  mutate(candidate);
  assert.throws(() => validateAllowlistDataset(defaultBase, candidate));
});

rejects("rejects a tampered frozen market value", (dataset) => { dataset.rankedCandidates[0].marketCapUsd += 1; });
rejects("rejects an unsupported chain row", (dataset) => { dataset.chains.push(structuredClone(dataset.chains[0])); dataset.chains.at(-1).chain = "eip155:2"; });
rejects("rejects a same-symbol token substitution even when both projections are changed", (dataset) => {
  const replacement = "0x0000000000000000000000000000000000000001";
  dataset.chains[0].verifiedTokenDeployments[0].identifier = replacement;
  dataset.rankedCandidates.find((row) => row.symbol === "USDC").verifiedDeployments
    .find((row) => row.chain === "eip155:1").identifier = replacement;
});
rejects("rejects an added unsupported deployment", (dataset) => {
  const token = structuredClone(dataset.chains[0].verifiedTokenDeployments[0]);
  token.identifier = "0x0000000000000000000000000000000000000001";
  dataset.chains[0].verifiedTokenDeployments.push(token);
  dataset.rankedCandidates.find((row) => row.symbol === "USDC").verifiedDeployments.push({ chain: "eip155:1", identifier: token.identifier });
});
rejects("rejects any enabled rail", (dataset) => { dataset.chains[0].native.rails.direct = true; });
rejects("rejects supplied caps in the unapproved candidate freeze", (dataset) => { dataset.chains[0].native.caps = { maximumPerTransferAtomic: "1", dailyLimitAtomic: "1" }; });
rejects("rejects altered FIGR_HELOC identity", (dataset) => { dataset.rankedCandidates[8].platformMetadata.platforms.provenance = "scope1changed"; });
rejects("rejects ambiguous top-ten versus native-addition semantics", (dataset) => { dataset.chains[4].native.selectionClass = "top_10"; });
