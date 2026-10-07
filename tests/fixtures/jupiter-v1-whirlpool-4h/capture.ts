import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { sha256 } from "../../../src/canonical.js";
import { decodeJupiterV1Quote, decodeJupiterV1Build } from "../../../src/swap/jupiter-solana/v1-codec.js";
import type { JupiterV1SemanticAccount } from "../../../src/swap/jupiter-solana/v1-material.js";
const dirs=[new URL("./",import.meta.url),new URL("../../../../tests/fixtures/jupiter-v1-whirlpool-4h/",import.meta.url)];
const dir=dirs.find(p=>existsSync(new URL("diagnostic-4h-public-capture.json.gz",p)));
if(dir===undefined)throw new Error("4H diagnostic TEST fixture missing");
const bytes=readFileSync(new URL("diagnostic-4h-public-capture.json.gz",dir));
if(sha256(bytes)!=="87779693cf16be43f5a9ef510be29a3108beed497f5214101655f0f549181fbb")throw new Error("4H diagnostic TEST fixture hash changed");
const data=JSON.parse(gunzipSync(bytes).toString("utf8")) as {diagnosticOnly:true;simulationObserved:false;mixedSlotTestFixture:true;quote:unknown;build:unknown;accounts:Omit<JupiterV1SemanticAccount,"dataHash">[]};
if(data.diagnosticOnly!==true||data.simulationObserved!==false||data.mixedSlotTestFixture!==true)throw new Error("4H TEST fixture provenance changed");
export function captured4H(){return {quote:decodeJupiterV1Quote(structuredClone(data.quote)),build:decodeJupiterV1Build(structuredClone(data.build)),accounts:data.accounts.map(a=>({...a,dataHash:sha256(Buffer.from(a.dataBase64,"base64"))}))};}
