import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { sha256 } from "../../../src/canonical.js";
import { decodeJupiterV1Quote, decodeJupiterV1Build } from "../../../src/swap/jupiter-solana/v1-codec.js";
import type { JupiterV1SemanticAccount } from "../../../src/swap/jupiter-solana/v1-material.js";
const bytes = readFileSync(new URL("./diagnostic-fp-public-capture.json.gz", import.meta.url));
if (sha256(bytes) !== "e28dfb6dc5ca813767e4ae0a0b20250972f493a17d320206fd6aee4d7d643c19") throw new Error("Fp public TEST capture changed");
const data = JSON.parse(gunzipSync(bytes).toString("utf8")) as {diagnosticOnly:true;simulationObserved:false;mixedSlotTestFixture:true;quote:unknown;build:unknown;accounts:Omit<JupiterV1SemanticAccount,"dataHash">[]};
if (data.diagnosticOnly !== true || data.simulationObserved !== false || data.mixedSlotTestFixture !== true) throw new Error("Fp TEST provenance changed");
export function capturedFp() {
 return { quote: decodeJupiterV1Quote(structuredClone(data.quote)), build: decodeJupiterV1Build(structuredClone(data.build)),
   accounts: data.accounts.map(a => ({ ...a, dataHash: sha256(Buffer.from(a.dataBase64,"base64")) })) };
}
