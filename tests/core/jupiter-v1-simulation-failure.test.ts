import test from "node:test";
import assert from "node:assert/strict";
import {fixture} from "../fixtures/jupiter-v1/material.js";
import {simulation} from "../fixtures/jupiter-v1/scenarios.js";
import {guardJupiterV1WhirlpoolMaterial} from "../../src/swap/jupiter-solana/v1-guard.js";
import {proveJupiterV1Simulation} from "../../src/swap/jupiter-solana/v1-proof.js";
import {ApnError} from "../../src/errors.js";
const cases:[string,unknown,string][]=[
 ["expired blockhash","BlockhashNotFound","blockhash_not_found"],
 ["fee funding","InsufficientFundsForFee","insufficient_funds_for_fee"],
 ["custom instruction",{InstructionError:[5,{Custom:6001}]},"instruction_error"],
 ["BigInt instruction",{InstructionError:[5n,{Custom:6001n}]},"instruction_error"],
 ["instruction text",{InstructionError:[5,"SECRET"]},"instruction_error"],
 ["unknown provider text","SECRET","unclassified"],
 ["out-of-bounds numbers",{InstructionError:[256,{Custom:4294967296}]},"instruction_error"],
];
for(const [name,err,reason] of cases)test(`simulation failure ${name} exposes only a fixed category and bounded numbers`,async()=>{
 const g=await guardJupiterV1WhirlpoolMaterial(fixture()),v=simulation(g) as any;v.value.err=err;v.value.logs=["SECRET"];
 let calls=0;
 await assert.rejects(proveJupiterV1Simulation({async call(){calls++;return v;}},g),error=>{
  assert.ok(error instanceof ApnError);assert.equal(error.code,"APN_OPERATION_BLOCKED");assert.equal(error.details?.simulationFailureReason,reason);
  assert.doesNotMatch(JSON.stringify(error.details),/SECRET|logs|rawPayload|transactionBase64/u);
  if(name==="custom instruction"||name==="BigInt instruction")assert.deepEqual(error.details,{simulationFailureReason:reason,instructionIndex:5,instructionCustomCode:6001});
  if(name==="out-of-bounds numbers")assert.deepEqual(error.details,{simulationFailureReason:reason});
  return true;
 });assert.equal(calls,1);
});
for(const kind of ["stale_context","replacement_blockhash"] as const)test(`simulation failure ${kind} cannot become success`,async()=>{
 const g=await guardJupiterV1WhirlpoolMaterial(fixture()),v=simulation(g) as any;
 if(kind==="stale_context")v.context.slot=1;else v.value.replacementBlockhash={blockhash:"SECRET",lastValidBlockHeight:1};
 await assert.rejects(proveJupiterV1Simulation({async call(){return v;}},g),error=>error instanceof ApnError&&error.details?.simulationFailureReason===kind);
});
