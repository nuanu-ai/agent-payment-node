import { getBase58Decoder, getBase58Encoder } from "@solana/kit";
import { exactKeys, isPlainRecord } from "../../canonical.js";
import { canonicalAddress, SYSTEM_PROGRAM, TOKEN_PROGRAM } from "./catalog.js";
import { ApnError } from "../../errors.js";

/** Three official RPC instruction encodings, normalized into one strictly bound compiled instruction. */
export function normalizeJupiterV1Cpi(value:unknown,keys:readonly string[]):Record<string,unknown> {
 const ix=record(value);
 if("programIdIndex" in ix){
  allowed(ix,["programIdIndex","accounts","data","stackHeight"]);
  if("programId" in ix||"parsed" in ix)reject();
  return ix;
 }
 const program=text(ix.programId),programIdIndex=index(program,keys);
 if("data" in ix){
  allowed(ix,["programId","accounts","data","stackHeight"]);
  if(!Array.isArray(ix.accounts)||ix.accounts.length>32||typeof ix.data!=="string")reject();
  return {programIdIndex,accounts:ix.accounts.map(key=>index(text(key),keys)),data:ix.data,stackHeight:ix.stackHeight};
 }
 allowed(ix,["programId","program","parsed","stackHeight"]);
 if(program!==TOKEN_PROGRAM&&program!==SYSTEM_PROGRAM||ix.program!==(program===TOKEN_PROGRAM?"spl-token":"system"))reject();
 const parsed=record(ix.parsed);if(!exactKeys(parsed,["type","info"]))reject();
 const info=record(parsed.info),type=parsed.type;
 let accounts:string[],bytes:Buffer;
 if(program===SYSTEM_PROGRAM){
  if(type!=="createAccount"||!exactKeys(info,["source","newAccount","owner","space","lamports"]))reject();
  accounts=[text(info.source),text(info.newAccount)];bytes=Buffer.alloc(52);
  bytes.writeUInt32LE(0,0);bytes.writeBigUInt64LE(uint(info.lamports),4);bytes.writeBigUInt64LE(uint(info.space),12);
  Buffer.from(getBase58Encoder().encode(text(info.owner))).copy(bytes,20);
 }else if(type==="transfer"){
  if(!exactKeys(info,["source","destination","authority","amount"]))reject();
  accounts=[text(info.source),text(info.destination),text(info.authority)];bytes=Buffer.alloc(9);bytes[0]=3;bytes.writeBigUInt64LE(amount(info.amount),1);
 }else if(type==="transferChecked"){
  if(!exactKeys(info,["source","mint","destination","authority","tokenAmount"]))reject();
  const token=record(info.tokenAmount);allowed(token,["amount","decimals","uiAmount","uiAmountString"]);
  const decimals=uint(token.decimals);if(decimals>255n)reject();
  if(token.uiAmount!==undefined&&token.uiAmount!==null&&(typeof token.uiAmount==="bigint"?token.uiAmount<0n||token.uiAmount>BigInt(Number.MAX_SAFE_INTEGER):typeof token.uiAmount!=="number"||!Number.isFinite(token.uiAmount)||token.uiAmount<0||token.uiAmount>Number.MAX_SAFE_INTEGER))reject();
  if(token.uiAmountString!==undefined&&(typeof token.uiAmountString!=="string"||token.uiAmountString.length>100))reject();
  accounts=[text(info.source),text(info.mint),text(info.destination),text(info.authority)];bytes=Buffer.alloc(10);bytes[0]=12;bytes.writeBigUInt64LE(amount(token.amount),1);bytes[9]=Number(decimals);
 }else if(type==="getAccountDataSize"){
  if(!exactKeys(info,["mint","extensionTypes"])||!Array.isArray(info.extensionTypes)||info.extensionTypes.length!==1||info.extensionTypes[0]!=="immutableOwner")reject();
  accounts=[text(info.mint)];bytes=Buffer.from([21,7,0]);
 }else if(type==="initializeImmutableOwner"){
  if(!exactKeys(info,["account"]))reject();accounts=[text(info.account)];bytes=Buffer.from([22]);
 }else if(type==="initializeAccount3"){
  if(!exactKeys(info,["account","mint","owner"]))reject();
  accounts=[text(info.account),text(info.mint)];bytes=Buffer.concat([Buffer.from([18]),Buffer.from(getBase58Encoder().encode(text(info.owner)))]);
 }else reject();
 return {programIdIndex,accounts:accounts.map(key=>index(key,keys)),data:getBase58Decoder().decode(bytes),stackHeight:ix.stackHeight};
}
function index(key:string,keys:readonly string[]):number{const result=keys.indexOf(key);if(result<0)reject();return result;}
function text(value:unknown):string{if(typeof value!=="string")reject();canonicalAddress(value);return value;}
function amount(value:unknown):bigint{if(typeof value!=="string"||!/^(0|[1-9][0-9]{0,19})$/u.test(value))reject();const result=BigInt(value);if(result>18446744073709551615n)reject();return result;}
function uint(value:unknown):bigint{if(typeof value==="bigint"&&value>=0n&&value<=18446744073709551615n)return value;if(typeof value==="number"&&Number.isSafeInteger(value)&&value>=0)return BigInt(value);return reject();}
function record(value:unknown):Record<string,unknown>{if(!isPlainRecord(value))reject();return value;}
function allowed(value:Record<string,unknown>,keys:readonly string[]):void{if(Object.keys(value).some(key=>!keys.includes(key)))reject();}
function reject():never{throw new ApnError("APN_OPERATION_BLOCKED","Jupiter V1 CPI encoding or parsed semantics changed.");}
