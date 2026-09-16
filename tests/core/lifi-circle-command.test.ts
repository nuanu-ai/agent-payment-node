import assert from "node:assert/strict";
import test from "node:test";
import { parseArgv } from "../../src/cli.js";

test("Circle approval command requires explicit bounded caps", () => {
  const args = ["circle", "approval", "prepare", "--profile", "default", "--cap-atomic", "430000",
    "--max-gas-limit-atomic", "100000", "--max-fee-per-gas-wei", "2000000000",
    "--max-priority-fee-per-gas-wei", "100000000", "--max-native-debit-wei", "200000000000000"];
  assert.equal(parseArgv(args).request.command, "circle.approval.prepare");
  assert.throws(() => parseArgv(args.slice(0, -2)), { code: "APN_INVALID_INPUT" });
  assert.deepEqual(parseArgv(["circle", "approval", "execute", "--operation", "a".repeat(64)]).request,
    { command: "circle.approval.execute", operationId: "a".repeat(64) });
});
test("Circle source command binds explicit owner, limits, and idempotency", () => {
  const args = ["circle", "source", "submit", "--profile", "default", "--expected-payer", "0x823A3a5BaB1186141b32fC65F8E25Ca24c679Ce7",
    "--recipient-owner", "11111111111111111111111111111111", "--recipient-setup", "existing_ata",
    "--amount-atomic", "430000", "--max-source-fee-atomic", "10000", "--max-allowance-atomic", "430000",
    "--max-gas-limit-atomic", "300000", "--max-fee-per-gas-wei", "2000000000",
    "--max-priority-fee-per-gas-wei", "100000000", "--max-native-debit-wei", "600000000000000",
    "--idempotency-key", "circle-first"];
  const request = parseArgv(args).request;
  assert.equal(request.command, "circle.source.submit");
  if (request.command !== "circle.source.submit") throw new Error("source binding");
  assert.equal(request.recipientSetup, "existing_ata");
  assert.equal(request.amountAtomic, "430000");
  assert.throws(() => parseArgv(args.map(v => v === "existing_ata" ? "automatic" : v)), { code: "APN_INVALID_INPUT" });
});
