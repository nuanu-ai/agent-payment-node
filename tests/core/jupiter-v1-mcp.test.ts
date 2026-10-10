import test from "node:test";
import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createMcpServer } from "../../src/mcp-server.js";
import { temporaryState } from "./helpers.js";
import type { OutputEnvelope } from "../../src/commands.js";
test("V1 MCP approval and execution return the exact real CLI handoff without constructing a Native signing session",async t=>{
 const temp=await temporaryState();t.after(temp.cleanup);let secretReads=0,rpcReads=0;
 const server=createMcpServer({stateRoot:temp.root,wrappingSecret:{async load(){secretReads++;throw new Error();},async create(){throw new Error();}},solanaRpcFetch:async()=>{rpcReads++;throw new Error();}});
 const [ct,st]=InMemoryTransport.createLinkedPair();await server.connect(st);const client=new Client({name:"jupiter-v1-boundary",version:"1.0.0"});await client.connect(ct);t.after(async()=>{await client.close();await server.close();});
 for(const action of ["approve","execute"]){const result=await client.callTool({name:`apn_swap_solana_jupiter_${action}`,arguments:{operation:"d".repeat(64)}}),content=result.content[0];assert.ok(content?.type==="text");const envelope=JSON.parse(content.text) as OutputEnvelope;
  assert.equal(envelope.ok,false);assert.equal(envelope.error?.code,"APN_FOREGROUND_APPROVAL_REQUIRED");assert.equal(envelope.error?.details?.cli_handoff,`apn swap solana jupiter ${action} --operation ${"d".repeat(64)}`);assert.equal(envelope.error?.details?.foreground_auth,true);
 }assert.equal(secretReads,0);assert.equal(rpcReads,0);
});
test("V1 inventory reports its additive mechanism while retained V2 Quantum remains dormant",async t=>{
 const temp=await temporaryState();t.after(temp.cleanup);const server=createMcpServer({stateRoot:temp.root});const [ct,st]=InMemoryTransport.createLinkedPair();await server.connect(st);const client=new Client({name:"jupiter-v1-inventory",version:"1.0.0"});await client.connect(ct);t.after(async()=>{await client.close();await server.close();});
 const result=await client.callTool({name:"apn_swap_solana_jupiter_inventory",arguments:{}}),content=result.content[0];assert.ok(content?.type==="text");const envelope=JSON.parse(content.text) as OutputEnvelope;assert.equal(envelope.ok,true);const data=envelope.data as {v1:{provenance:string;admitted:boolean;installed:boolean};v2Quantum:{signable:boolean;execution:string}};
 assert.equal(data.v1.provenance,"runtime_bytes_only");assert.equal(data.v1.installed,true);assert.equal(data.v1.admitted,false);assert.equal(data.v2Quantum.signable,false);assert.equal(data.v2Quantum.execution,"dormant");
});
