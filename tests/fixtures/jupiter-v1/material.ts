import { gunzipSync } from "node:zlib";
import { getAddressDecoder } from "@solana/kit";
import { sha256 } from "../../../src/canonical.js";
import { decodeJupiterV1Quote, decodeJupiterV1Build, jupiterV1Instructions, jupiterV1Lifetime, jupiterV1ResponseHash } from "../../../src/swap/jupiter-solana/v1-codec.js";
import { assembleJupiterV1, decodeJupiterV1AddressTable } from "../../../src/swap/jupiter-solana/v1-resolver.js";
import { JUPITER_V1_MATERIAL_SCHEMA, jupiterV1MaterialDigest, type JupiterV1ResolvedMaterial } from "../../../src/swap/jupiter-solana/v1-material.js";
import { JUPITER_V1_RUNTIME_PROGRAM_PINS } from "../../../src/swap/jupiter-solana/v1-pins.js";
import { SOLANA_MAINNET_GENESIS } from "../../../src/swap/jupiter-solana/catalog.js";
import { existsSync, readFileSync } from "node:fs";
// Expired public diagnostic capture; mocked height/fee in fixture() are not live evidence.
const capturePaths=[new URL("./diagnostic-v1-public-capture.json.gz",import.meta.url),new URL("../../../../tests/fixtures/jupiter-v1/diagnostic-v1-public-capture.json.gz",import.meta.url)];
const capturePath=capturePaths.find(p=>existsSync(p));if(capturePath===undefined)throw new Error("Jupiter V1 public diagnostic fixture is missing.");
const capture=JSON.parse(gunzipSync(readFileSync(capturePath)).toString()) as {quote:unknown;build:unknown;accounts:[string,{owner:string;executable:boolean;lamports:number;data:[string,string]}|null,string][]};
export function fixture():JupiterV1ResolvedMaterial{
 const quoteResponse=decodeJupiterV1Quote(capture.quote),rawBuildResponse=decodeJupiterV1Build(capture.build),payer="GtZc9wfM98Peee7dJrL1dYE54sWU8zA8gYeo9VUfR9ki";
 const semanticAccounts=capture.accounts.map(([address,a,slot])=>({address,existence:a===null?"absent" as const:"present" as const,owner:a?.owner??null,executable:a?.executable??false,lamports:String(a?.lamports??0),dataBase64:a?.data[0]??"",dataHash:sha256(Buffer.from(a?.data[0]??"","base64")),slot}));
 const addressTables=rawBuildResponse.addressLookupTableAddresses.map(key=>decodeJupiterV1AddressTable(semanticAccounts.find(a=>a.address===key)!));
 const programPins=[...new Set(jupiterV1Instructions(rawBuildResponse).map(ix=>ix.programId).concat(JUPITER_V1_RUNTIME_PROGRAM_PINS.map(p=>p.programId)))].map(programId=>{const a=semanticAccounts.find(x=>x.address===programId)!,pin=JUPITER_V1_RUNTIME_PROGRAM_PINS.find(x=>x.programId===programId),pd=pin===undefined?undefined:semanticAccounts.find(x=>x.address===pin.programDataAddress),d=Buffer.from(pd?.dataBase64??"","base64");return {programId,loader:a.owner!,programDataAddress:pin?.programDataAddress??null,deploymentSlot:pd===undefined?null:d.readBigUInt64LE(4).toString(),upgradeAuthority:pd===undefined||d[12]===0?null:getAddressDecoder().decode(d.subarray(13,45)),accountHash:a.dataHash,programDataHash:pd?.dataHash??null,storedPayloadHash:pin?.payloadHash??a.dataHash,provenance:"runtime_bytes_only" as const};});
 const body={schemaVersion:JUPITER_V1_MATERIAL_SCHEMA,genesis:SOLANA_MAINNET_GENESIS,payer,quoteResponse,rawBuildResponse,quoteResponseHash:jupiterV1ResponseHash(quoteResponse),rawBuildResponseHash:jupiterV1ResponseHash(rawBuildResponse),lifetime:jupiterV1Lifetime(rawBuildResponse),...assembleJupiterV1(payer,rawBuildResponse,addressTables),rawInstructions:jupiterV1Instructions(rawBuildResponse),semanticAccounts,addressTables,programPins,accountSlot:"454241550",currentBlockHeight:"432279120",networkFeeLamports:"6400",tokenAccountRentLamports:"1488440",maximumNativeExpenseLamports:"6000000"};return {...body,materialDigest:jupiterV1MaterialDigest(body)};
}
export function mutate(m:JupiterV1ResolvedMaterial,fn:(v:any)=>void):JupiterV1ResolvedMaterial{const v:any=structuredClone(m);fn(v);v.quoteResponseHash=jupiterV1ResponseHash(v.quoteResponse);v.rawBuildResponseHash=jupiterV1ResponseHash(v.rawBuildResponse);v.rawInstructions=jupiterV1Instructions(v.rawBuildResponse);for(const a of v.semanticAccounts)a.dataHash=sha256(Buffer.from(a.dataBase64,"base64"));Object.assign(v,assembleJupiterV1(v.payer,v.rawBuildResponse,v.addressTables));const {materialDigest,...body}=v;return {...body,materialDigest:jupiterV1MaterialDigest(body)};}
