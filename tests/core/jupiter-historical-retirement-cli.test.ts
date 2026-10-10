import test from "node:test";
import assert from "node:assert/strict";
import { executeHistoricalJupiterRetirementCli, isHistoricalJupiterRetirementCli } from "../../src/swap/jupiter-solana/historical-retirement-cli.js";
import { HISTORICAL_JUPITER_IDS } from "../../src/swap/jupiter-solana/historical-pins.js";
import { runCli } from "../../src/cli.js";
import { COMMANDS } from "../../src/command-catalog.js";
import { MCP_TOOLS } from "../../src/mcp-projection.js";

const path = ["swap", "solana", "jupiter", "historical-retire"];
const id = HISTORICAL_JUPITER_IDS[0];
for (const tail of [[], ["--operation"], ["--operation", "unknown"], ["--operation", id, "--operation", id],
  ["--operation", id, "--profile", "solana-local"], ["--operation", id, "--root", "/TEST_ONLY/other"],
  ["--operation", id, "--rpc-url", "https://invalid.example"], ["--operation", id, "--cap", "6000000"],
  ["--operation", id, "--callback", "caller"], ["--operation=" + id], [id],
  ["--operation", id, "--"], ["--operation", id.toUpperCase()]]) {
  test(`strict historical retirement CLI refuses ${JSON.stringify(tail)} before root or custody`, async () => {
    let roots = 0;
    const result = await executeHistoricalJupiterRetirementCli([...path, ...tail], () => {
      roots++; throw Error("must not resolve root");
    });
    assert.equal(result.ok, false); assert.equal(result.error?.code, "APN_INVALID_INPUT");
    assert.equal(roots, 0); assert.equal(result.data, null);
    const normal = await runCli([...path, ...tail], {}, { stateRoot: "/TEST_ONLY/must-not-read" });
    assert.deepEqual(normal.error, result.error);
    assert.equal(normal.operation, null); assert.equal(normal.receipt, null);
  });
}
test("retirement route remains CLI-only and leaves the exact MCP122 catalog unchanged", () => {
  assert.equal(COMMANDS.some(command => command.path.includes("historical-retire")), false);
  assert.equal(MCP_TOOLS.length, 122);
  assert.equal(isHistoricalJupiterRetirementCli([...path, "--operation", id]), true);
  assert.equal(isHistoricalJupiterRetirementCli(["swap", "solana", "jupiter", "historical-retire-extra"]), false);
});
