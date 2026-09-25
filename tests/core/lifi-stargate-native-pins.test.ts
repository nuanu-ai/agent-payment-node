import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { encodeFunctionData, getAddress } from "viem";
import { deploymentAbi } from "../../src/lifi/abi.js";
import { bridgeDeployment } from "../../src/lifi/deployments.js";
import { BRIDGE_ZERO_ADDRESS } from "../../src/lifi/validation.js";

type Capture = { chains: Array<{ chain: string; safe_header: { number: string; hash: string; timestamp: string };
  state_block_hash: string; hash_pinned_eip1898: boolean; batch_members_sent: number;
  code_hashes: Record<string, { keccak256: string }>;
  call_results: Record<string, string>; semantic_status: string }>;
  safe_header_timestamp_delta_seconds: number; physical_post_count: number; semantic_status: string };
const capture = JSON.parse(readFileSync(resolve("tests/core/lifi-fixtures/lifi-stargate-native-paired-safe-20260925.json"), "utf8")) as Capture;
const selectorCapture = JSON.parse(readFileSync(resolve("tests/core/lifi-fixtures/lifi-stargate-native-executable-selector-20260925.json"), "utf8")) as {
  physical_posts: number; rows: Array<{ chain: string; http_status: number; block_hash: string;
    eip1898_requireCanonical: boolean; chain_id_result: string; facet_selector: string;
    facet_result: string; matches_prior_pinned_facet: boolean; rpc_errors: unknown[] }> };

test("native Stargate admission pins both paired safe-state contract bundles", () => {
  assert.equal(capture.semantic_status, "pass");
  assert.equal(capture.physical_post_count, 4);
  assert.equal(selectorCapture.physical_posts, 2);
  assert.equal(capture.safe_header_timestamp_delta_seconds, 558);
  for (const [chainId, peerId, label] of [[1, 8453, "ethereum"], [8453, 1, "base"]] as const) {
    const header = capture.chains.find((row) => row.chain === label && row.safe_header !== undefined)!;
    const observed = capture.chains.find((row) => row.chain === label && row.state_block_hash !== undefined)!;
    const deployment = bridgeDeployment(chainId, peerId, "stargateV2", BRIDGE_ZERO_ADDRESS);
    assert.equal(observed.semantic_status, "pass");
    assert.equal(observed.hash_pinned_eip1898, true);
    assert.equal(observed.state_block_hash, header.safe_header.hash);
    assert.equal(observed.batch_members_sent, 8);
    assert.deepEqual(deployment.code.map((row) => row.codeHash),
      ["pool", "messaging", "diamond", "facet"].map((key) => observed.code_hashes[key]!.keccak256));
    assert.equal(deployment.reads.length, 5);
    const selectors = [
      ["stargateImpls", [13], "stargateImpls(13)"],
      ["facetAddress", ["0x14d53077"], "facetAddress(0x14d53077)"],
      ["facetAddress", ["0xa6010a66"], "executable_selector"],
      ["getAddressConfig", [], "pool.getAddressConfig()"],
      ["tokenMessaging", [], "facet.tokenMessaging()"],
    ] as const;
    const executable = selectorCapture.rows.find((row) => row.chain === label)!;
    assert.equal(executable.http_status, 200);
    assert.equal(executable.block_hash, observed.state_block_hash);
    assert.equal(executable.eip1898_requireCanonical, true);
    assert.equal(executable.chain_id_result, `0x${chainId.toString(16)}`);
    assert.equal(executable.facet_selector, "0xa6010a66");
    assert.equal(executable.matches_prior_pinned_facet, true);
    assert.deepEqual(executable.rpc_errors, []);
    for (const [index, [name, args, key]] of selectors.entries()) {
      assert.equal(deployment.reads[index]!.data,
        encodeFunctionData({ abi: deploymentAbi, functionName: name as never, args: args as never }));
      assert.equal(deployment.reads[index]!.expected.toLowerCase(),
        (key === "executable_selector" ? executable.facet_result : observed.call_results[key]!).toLowerCase());
    }
    const mapping = `0x${observed.call_results["stargateImpls(13)"]!.slice(-40)}`;
    assert.equal(getAddress(mapping), deployment.protocolEmitter);
    assert.equal(deployment.code[0]!.address, deployment.protocolEmitter);
    assert.equal(deployment.reads[3]!.address, deployment.protocolEmitter);
  }
});

test("native Stargate refuses other peers and wrong provider/tool", () => {
  assert.throws(() => bridgeDeployment(1, 42161, "stargateV2", BRIDGE_ZERO_ADDRESS),
    { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
  assert.throws(() => bridgeDeployment(8453, 42161, "stargateV2", BRIDGE_ZERO_ADDRESS),
    { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
  assert.throws(() => bridgeDeployment(1, 8453, "other" as "stargateV2", BRIDGE_ZERO_ADDRESS),
    { code: "APN_PROVIDER_CAPABILITY_UNAVAILABLE" });
  assert.equal(bridgeDeployment(1, 8453, "stargateV2", BRIDGE_ZERO_ADDRESS).reads[0]!.expected,
    capture.chains.find((row) => row.chain === "ethereum" && row.call_results !== undefined)!.call_results["stargateImpls(13)"]);
});
