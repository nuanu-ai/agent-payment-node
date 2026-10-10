import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { sha256 } from "../../../src/canonical.js";
import { decodeJupiterV1Quote, decodeJupiterV1Build } from "../../../src/swap/jupiter-solana/v1-codec.js";
import type { JupiterV1SemanticAccount } from "../../../src/swap/jupiter-solana/v1-material.js";
// Genuine unsigned public diagnostic bytes. No simulation, quote proof or financial acceptance.
const dirs=[new URL("./",import.meta.url),new URL("../../../../tests/fixtures/jupiter-v1-whirlpool-v2/",import.meta.url)];
const dir=dirs.find(p=>existsSync(new URL("diagnostic-v2-public-capture.json.gz",p)));
if(dir===undefined)throw new Error("V2 diagnostic fixture missing");
const compressed=readFileSync(new URL("diagnostic-v2-public-capture.json.gz",dir)), manifest=JSON.parse(readFileSync(new URL("manifest.json",dir),"utf8"));
if(manifest.fixtureSha256!=="f431c01dc29942ea1a179ebca6ce3ffa8f49a42772e8846b61eca1013577517e"||sha256(compressed)!==manifest.fixtureSha256)throw new Error("V2 diagnostic fixture hash changed");
const data=JSON.parse(gunzipSync(compressed).toString("utf8")) as {diagnosticOnly:true;simulationObserved:false;quote:unknown;build:unknown;accounts:Omit<JupiterV1SemanticAccount,"dataHash">[];actualFeeLamports:string;actualHeight:string};
if(data.diagnosticOnly!==true||data.simulationObserved!==false)throw new Error("Diagnostic fixture mislabeled");
export function capturedV2() { return {quote:decodeJupiterV1Quote(structuredClone(data.quote)),build:decodeJupiterV1Build(structuredClone(data.build)),accounts:data.accounts.map(a=>({...a,dataHash:sha256(Buffer.from(a.dataBase64,"base64"))})),fee:data.actualFeeLamports,height:data.actualHeight}; }
