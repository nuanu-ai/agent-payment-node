import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256 } from "../../src/canonical.js";
import { evmChain } from "../../src/evm-asset.js";
import { StateStore } from "../../src/state.js";
import { networkFixture, networkPaid, networkSettlement } from "./evm-x402-helpers.js";

const [phase, root, operationId] = process.argv.slice(2);
if (root === undefined || operationId === undefined) throw new Error("missing synthetic worker arguments");
const stored = await new StateStore(root).findX402Operation(operationId);
if (stored === null) throw new Error("missing frozen synthetic operation");
const fixture = networkFixture(root, evmChain(stored.network), (native) => ({ request: async (request) => {
  if (phase !== "sign-crash" && request.operation === "x402Exact.approveAndAuthorize") throw new Error("replacement authorization forbidden");
  const result = await native.request(request);
  if (phase === "sign-crash" && request.operation === "x402Exact.approveAndAuthorize") process.exit(75);
  return result;
} }));
const original = await fixture.state.findX402Operation(operationId);
if (original === null) throw new Error("missing synthetic operation");
fixture.http.outcomes.length = 0;
const exposurePath = join(root, "synthetic-exposure.json");
fixture.http.get = async (request) => {
  fixture.http.calls.push(request);
  if (request.paymentSignature === undefined) throw new Error("unexpected replacement challenge");
  const identity = { headerHash: sha256(request.paymentSignature), requestHash: sha256(JSON.stringify(request.httpRequest ?? null)) };
  if (phase === "send-crash") {
    await writeFile(exposurePath, JSON.stringify(identity), { mode: 0o600, flag: "wx" });
    process.exit(76);
  }
  const exposed = JSON.parse(await readFile(exposurePath, "utf8"));
  if (JSON.stringify(identity) !== JSON.stringify(exposed)) throw new Error("recovery changed authorization or HTTP bytes");
  return networkPaid(original);
};
if (phase === "settle") {
  fixture.rpc.blockHashes.set(fixture.rpc.safeHead.number, fixture.rpc.safeHead.hash);
  fixture.rpc.blockTimestamps.set(fixture.rpc.safeHead.number, fixture.rpc.safeHead.timestamp);
  fixture.rpc.safeHead = { ...fixture.rpc.safeHead, number: "12346", hash: `0x${"e".repeat(64)}` };
  networkSettlement(fixture.rpc, original);
  fixture.rpc.logOutcomes = [{ kind: "complete", logs: [fixture.rpc.x402Receipt!.logs[0]!] }];
}
const result = await fixture.core.execute(phase === "sign-crash" ? { command: "x402.fetch.approve", operationId } : { command: "operation.resume", operationId });
console.log(JSON.stringify({ result, signatures: fixture.nativeCalls.filter((call) => call.operation === "x402Exact.approveAndAuthorize").length, httpCalls: fixture.http.calls.length }));
