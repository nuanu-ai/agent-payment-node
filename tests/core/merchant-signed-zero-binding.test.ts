import assert from "node:assert/strict";
import test from "node:test";
import { fromRlp, keccak256, parseTransaction, toRlp, type Hex, type TransactionSerializableEIP1559 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { MerchantOperation } from "../../src/x402-merchant/model.js";

// A separate test worker substitutes only the pinned owner with an isolated key.
// Signing, RLP parsing, address recovery and the production verifier are real.
test("production merchant verifier accepts canonical omitted zeros and rejects signed envelope mutations", async t => {
    const account = privateKeyToAccount(`0x${"01".repeat(32)}`);
    const other = privateKeyToAccount(`0x${"02".repeat(32)}`);
    const pins = await import("../../src/x402-merchant/pins.js");
    const fixture = t.mock.module("../../src/x402-merchant/pins.js", { namedExports: { ...pins, MERCHANT_OWNER: account.address } });
    const { verifyMerchantRaw } = await import("../../src/x402-merchant/custody.js");
    const { MERCHANT_DATA } = await import("../../src/x402-merchant/rpc.js");
    const o = { envelope: { nonce: "0", gas: "129299", maxFeePerGas: "2000000", maxPriorityFeePerGas: "0" } } as MerchantOperation;
    const payload: TransactionSerializableEIP1559 = { type: "eip1559", chainId: 4326, to: pins.MERCHANT_TOKEN, data: MERCHANT_DATA,
        value: 0n, nonce: 0, gas: 129299n, maxFeePerGas: 2000000n, maxPriorityFeePerGas: 0n, accessList: [] };
    try {
        const raw = await account.signTransaction(payload);
        const parsed = parseTransaction(raw);
        assert.equal(parsed.value, undefined);
        assert.equal(parsed.maxPriorityFeePerGas, undefined);
        assert.equal(parsed.accessList, undefined);
        assert.equal(await verifyMerchantRaw(o, raw), keccak256(raw));
        for (const [name, delta] of Object.entries({
            value: { value: 1n }, priority: { maxPriorityFeePerGas: 1n },
            accessList: { accessList: [{ address: pins.MERCHANT_TOKEN, storageKeys: [] }] },
            chain: { chainId: 8453 }, nonce: { nonce: 1 }, gas: { gas: 129300n },
            fee: { maxFeePerGas: 2000001n }, recipient: { to: pins.MERCHANT_PAYEE }, data: { data: "0x" as const },
        })) await t.test(name, async () => {
            const wrong = await account.signTransaction({ ...payload, ...delta });
            await assert.rejects(verifyMerchantRaw(o, wrong), error => (error as {details?: {reason?: string}}).details?.reason === "merchant_signed_transaction_binding");
        });
        await t.test("wrong signer", async () => assert.rejects(verifyMerchantRaw(o, await other.signTransaction(payload))));
        await t.test("wrong transaction type", async () => assert.rejects(verifyMerchantRaw(o, await account.signTransaction({
            type: "legacy", chainId: 4326, to: pins.MERCHANT_TOKEN, data: MERCHANT_DATA, value: 0n, nonce: 0, gas: 129299n, gasPrice: 2000000n,
        }))));
        await t.test("malformed access-list RLP", async () => assert.rejects(verifyMerchantRaw(o, "0x02c0")));
        await t.test("malformed access-list member", async () => {
            const fields = fromRlp(`0x${raw.slice(4)}`, "hex") as (Hex | Hex[])[];
            fields[8] = ["0x01"];
            await assert.rejects(verifyMerchantRaw(o, `0x02${toRlp(fields).slice(2)}`));
        });
    } finally { fixture.restore(); }
});
