import test from "node:test";
import assert from "node:assert/strict";
import { HISTORICAL_JUPITER_IDS } from "../../src/swap/jupiter-solana/historical-pins.js";
import { executeHistoricalJupiterCli } from "../../src/swap/jupiter-solana/historical-cli.js";

// Transport/output contract doubles only. These tests issue no real cryptographic authority.
test("CLI output contract consumes same private token immediately and emits only public projection", async t => {
  const id = HISTORICAL_JUPITER_IDS[0]!, calls: string[] = [], token = Object.freeze({privateCanary: "NOT_PUBLIC"});
  const projection = {operationId: id, schemaVersion: "apn.jupiter-historical-authentication.v1",
    originalQuoteRpcLifetime: {source: "configured_mainnet_rpc_before_quote_freeze", rpcOriginHash: "a".repeat(64),
      contextSlot: "1", minimumContextSlot: "1", blockhash: "PUBLIC", lastValidBlockHeight: "2", secret: "NOT_PUBLIC"},
    retainedClaimEvidence: {kind:"retained_send_claim_present", claimHash:"b".repeat(64), secret:"NOT_PUBLIC"},
    rawPayload: "NOT_PUBLIC", authority: token};
  const auth = t.mock.module("../../src/swap/jupiter-solana/historical-authenticator.js", {namedExports: {
    JupiterHistoricalAuthenticator: class {
      constructor(root: string, wrapping: unknown) { assert.equal(root, "/TEST_ONLY/root"); assert.ok(wrapping); calls.push("construct"); }
      async authenticate(op: string) { assert.equal(op, id); calls.push("authenticate"); return {projection: {secret: "NOT_PUBLIC"}, authority: token}; }
      async consume(authority: unknown, op: string) { assert.equal(authority, token); assert.equal(op, id); calls.push("consume"); return projection; }
    },
  }});
  const key = t.mock.module("../../src/macos-keychain.js", {namedExports: {MacOSLoginKeychainSecret: class {constructor(){calls.push("wrapping-construct");}}}});
  t.after(() => {auth.restore(); key.restore();});
  const result = await executeHistoricalJupiterCli(["swap", "solana", "jupiter", "historical-authenticate", "--operation", id], () => "/TEST_ONLY/root");
  assert.equal(result.ok, true); assert.equal(result.proof_class, "historical_material_authentication_only");
  assert.deepEqual(calls, ["wrapping-construct", "construct", "authenticate", "consume"]);
  assert.equal(JSON.stringify(result).includes("NOT_PUBLIC"), false);
  assert.equal(result.operation, null); assert.equal(result.receipt, null); assert.deepEqual(result.next_actions, []);
});
for (const reason of ["noTTY", "rejected", "expired", "root-drift", "consume-expired"])
  test(`CLI error contract ${reason} never exports raw exception/material`, async t => {
    let consumed = 0;
    const auth = t.mock.module("../../src/swap/jupiter-solana/historical-authenticator.js", {namedExports: {JupiterHistoricalAuthenticator: class {
      async authenticate() {if(reason!=="consume-expired")throw Error("NOT_PUBLIC:"+reason);return {authority:{},projection:{rawPayload:"NOT_PUBLIC"}};}
      async consume() {consumed++;throw Error("NOT_PUBLIC:"+reason);}
    }}});
    const key = t.mock.module("../../src/macos-keychain.js", {namedExports: {MacOSLoginKeychainSecret: class {}}});
    t.after(() => {auth.restore(); key.restore();});
    const result = await executeHistoricalJupiterCli(["swap", "solana", "jupiter", "historical-authenticate", "--operation", HISTORICAL_JUPITER_IDS[0]!], () => "/TEST_ONLY/root");
    assert.equal(result.ok,false);assert.equal(result.data,null);assert.equal(consumed,reason==="consume-expired"?1:0);
    assert.equal(JSON.stringify(result).includes("NOT_PUBLIC"),false);
  });

test("CLI absent retained claim is a current observation with unknown submission history",async t=>{
 const id=HISTORICAL_JUPITER_IDS[1],token=Object.freeze({}),projection={operationId:id,originalQuoteRpcLifetime:null,
  retainedClaimEvidence:{kind:"retained_send_claim_absent",observation:"current_observation",submissionHistory:"unknown",transactionMayHaveBeenSubmitted:true,absenceSnapshotHash:"c".repeat(64),secret:"NOT_PUBLIC"},seedHex:"NOT_PUBLIC"};
 const auth=t.mock.module("../../src/swap/jupiter-solana/historical-authenticator.js",{namedExports:{JupiterHistoricalAuthenticator:class{async authenticate(){return {authority:token};}async consume(v:unknown,op:string){assert.equal(v,token);assert.equal(op,id);return projection;}}}});
 const key=t.mock.module("../../src/macos-keychain.js",{namedExports:{MacOSLoginKeychainSecret:class{}}});t.after(()=>{auth.restore();key.restore();});
 const result=await executeHistoricalJupiterCli(["swap","solana","jupiter","historical-authenticate","--operation",id],()=>"/TEST_ONLY/root");
 assert.equal(result.ok,true);assert.equal(result.operation,null);assert.equal(result.receipt,null);assert.deepEqual(result.next_actions,[]);
 const actual=(result.data as {projection:{retainedClaimEvidence:unknown}}).projection.retainedClaimEvidence;
 assert.deepEqual(actual,{kind:"retained_send_claim_absent",observation:"current_observation",submissionHistory:"unknown",transactionMayHaveBeenSubmitted:true,absenceSnapshotHash:"c".repeat(64)});
 assert.equal(JSON.stringify(result).includes("NOT_PUBLIC"),false);assert.equal(JSON.stringify(result).includes("wasSubmitted"),false);
});
