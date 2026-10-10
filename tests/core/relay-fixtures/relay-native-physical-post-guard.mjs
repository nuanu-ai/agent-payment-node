import assert from 'node:assert/strict';
import {mock} from 'node:test';
import {EventEmitter} from 'node:events';
let checks=0, sends=0, stale=false;
mock.module('node:https',{exports:{request:(_endpoint,_options,_response)=>{
 const request=new EventEmitter(), socket=new EventEmitter();request.setTimeout=()=>request;request.destroy=()=>{request.emit('close');};request.end=()=>{sends++;};
 queueMicrotask(()=>{request.emit('socket',socket);stale=true;socket.emit('secureConnect');});return request;
}}});
const {postJson}=await import(process.argv[2]);
await assert.rejects(postJson(new URL('https://example.com'), '{}', [{address:'1.1.1.1',family:4}],1000,'eth_sendRawTransaction',false,undefined,undefined,()=>{checks++;if(stale)throw new Error('late authority expiry');}), /late authority expiry/);
assert.equal(checks,2);assert.equal(sends,0);console.log('TLS physical request.end gate: checks=2, sends=0');
