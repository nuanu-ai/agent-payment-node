import assert from "node:assert/strict";
import test from "node:test";
import { getAddress } from "viem";
import { parseArgv } from "../../src/cli.js";
import { hashObject } from "../../src/canonical.js";
const base = ["circle", "evm", "prepare", "--profile", "evm-live-buyer", "--destination-profile", "default", "--destination-chain", "143", "--idempotency-key", "funding-example-1"];
const options = ["--beneficiary", "--gross-atomic", "--max-issuer-fee-atomic", "--min-mint-atomic"];
const values = [getAddress(`0x${"55".repeat(20)}`), "510000", "10000", "500000"];
test("old prepare request shape and hash stay unchanged; explicit funding is separate", () => {
 const old = { command: "circle.evm.prepare", profile: "evm-live-buyer", destinationProfile: "default", destinationChain: 143, idempotencyKey: "funding-example-1" };
 assert.deepEqual(parseArgv(base).request, old); assert.equal(hashObject(parseArgv(base).request), hashObject(old));
 const request = parseArgv([...base, ...options.flatMap((o,i) => [o, values[i]!])]).request;
 assert.deepEqual(request, { ...old, funding: { recipient: values[0], amountAtomic: values[1], maxFeeAtomic: values[2], minMintAtomic: values[3] } });
 for (const recipient of [getAddress(`0x${"66".repeat(20)}`), values[0]!]) assert.equal((parseArgv([...base, "--beneficiary", recipient, ...options.slice(1).flatMap((o,i) => [o, values[i+1]!])]).request as {funding:{recipient:string}}).funding.recipient, recipient);
});
for (let mask=1;mask<15;mask++) test(`partial funding tuple ${mask} refuses`, () => { assert.throws(() => parseArgv([...base, ...options.flatMap((o,i) => mask & (1<<i) ? [o, values[i]!] : [])]), {code:"APN_INVALID_INPUT"}); });
for (const [field,value] of [[0,"0x0000000000000000000000000000000000000000"],[1,"0510000"],[1,"0"],[1,(1n<<256n).toString()],[2,"510000"],[3,"500001"],[2,"0"]] as const) test(`invalid funding operand ${field}/${value} refuses`, () => { const v=[...values];v[field]=value;assert.throws(()=>parseArgv([...base,...options.flatMap((o,i)=>[o,v[i]!])]),{code:"APN_INVALID_INPUT"}); });
test("funding duplicates and unknown options refuse",()=>{assert.throws(()=>parseArgv([...base,"--gross-atomic","1","--gross-atomic","2"]));assert.throws(()=>parseArgv([...base,"--funding-authority","x"]));});
