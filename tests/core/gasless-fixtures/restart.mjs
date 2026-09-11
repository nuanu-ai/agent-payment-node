import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const load = (path) => import(pathToFileURL(resolve(path)).href);
const [{ GaslessOperationRepository }, { gaslessFixture, GaslessTestRpc }] = await Promise.all([
  load("dist-test/src/gasless/operation-repository.js"), load("dist-test/tests/core/gasless-helpers.js"),
]);
const [root, id] = process.argv.slice(2);
const op = await new GaslessOperationRepository(root).findOperation(id);
const now = new Date(Date.parse(op.intent.expiresAt) + 360000);
const rpc = new GaslessTestRpc(op.intent.request.chainId, op.intent.owner.address, op.intent.initialSnapshot.delegation, now);
rpc.current = op.intent.initialSnapshot;
rpc.sends.push({ role: "test-only-accepted-original" });
let signingCalls = 0;
const custody = { load: async () => { throw new Error("Unexpected custody load"); },
  seal: async () => { signingCalls++; throw new Error("Unexpected signing"); } };
const s = await gaslessFixture(root, op.intent.request.chainId, { rpc, custody, now, initializeWallet: false });
const result = await s.core.execute({ command: "operation.resume", operationId: id });
const final = await s.record(id);
process.stdout.write(JSON.stringify({ ok: result.ok, error: result.error?.message, state: final.state, signingCalls,
  sendCalls: rpc.calls.filter((c) => c === "send").length, estimateCalls: rpc.calls.filter((c) => c === "estimate").length,
  userOperationHash: final.userOperation.userOperationHash, bootstrapMaterialHash: final.bootstrap.materialHash,
  wrappingLoads: s.wrapping.loads }));
