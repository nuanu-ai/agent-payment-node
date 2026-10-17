import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { sha256 } from "../../src/canonical.js";
import type { EvmChainId } from "../../src/evm-asset.js";
import { FEE_RECIPIENT } from "../../src/lifi/abi.js";
import type { BridgeTool } from "../../src/lifi/model.js";

/** The 2026-09-08 mainnet deployment capture. The full historical deployment proof that replayed it was deleted with
 * `operation repair-deployment`; live bridges use the light check (deployment-check.ts, lifi-rpc-prepare-batch.test.ts). */
type Entry = { request: { method: string; params: unknown[] }; response: { result: unknown } };
type Capture = { chainId: EvmChainId; rpcOrigin: string; requests: Entry[];
  safeBlock: { number: string; hash: string; timestamp: string }; verification: { chainMatches: boolean; blockMatches: boolean };
  invocations: Array<{ peerChainId: EvmChainId; tool: BridgeTool }> };
const raw = await readFile(resolve("tests/core/lifi-fixtures/deployment-rpc-20260908.json"), "utf8");
assert.equal(sha256(raw), "a07fc84d38e22270965e4a43c4e42fec426256afdebe4de5a8f7898b160cbe6e");
const fixture = JSON.parse(raw) as { chains: Capture[]; verification: { fixtureRequestCount: number; allChainsPassed: boolean } };

test("LI.FI frozen deployment capture preserves the independently observed owner-versus-recipient mismatch", () => {
  assert.equal(fixture.verification.fixtureRequestCount, 119); assert.equal(fixture.verification.allChainsPassed, false);
  for (const chain of fixture.chains) {
    assert.equal(chain.verification.chainMatches, true); assert.equal(chain.verification.blockMatches, true);
    const owner = chain.requests.find((r) => r.request.method === "eth_call" &&
      (r.request.params[0] as { data: string }).data === "0x8da5cb5b")!;
    assert.equal(owner.response.result, "0x00000000000000000000000008647cc950813966142a416d40c382e2c5db73bb");
    assert.notEqual((owner.response.result as string).slice(-40), FEE_RECIPIENT.slice(2).toLowerCase());
  }
});
