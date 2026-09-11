import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Transaction, Wallet, type TransactionRequest } from "ethers";
import type { Hex } from "../../src/model.js";
import { verifyMetaMaskOuterTransaction } from "../../src/metamask-gasless/chain/transaction.js";
import { mmRegistry } from "../../src/metamask-gasless/registry.js";
import { makeIntent } from "./metamask-gasless-journal-fixtures/factory.js";

type Json = Record<string, any>;
const vector = JSON.parse(readFileSync(
  "tests/core/metamask-gasless-chain-fixtures/base-signed-vector.json", "utf8")) as Json;
const payer = new Wallet(`0x${"3".repeat(64)}`);
const quantity = (value: bigint | number): Hex => `0x${BigInt(value).toString(16)}`;
const blobHash = `0x01${"67".repeat(31)}`;

for (const type of [0, 1, 3] as const) test(`ethers-signed outer transaction type ${type} is reconstructed`, async () => {
  const signed = await signedOuter(type);
  const verified = await verifyMetaMaskOuterTransaction(signed.raw, signed.hash, makeIntent("outer-types", "empty"));
  assert.equal(verified.typeAtomic, String(type));
  assert.equal(verified.from, payer.address.toLowerCase());
  assert.equal(verified.to, mmRegistry(8453).row.protocol.manager.address);
  assert.equal(verified.input, vector.redemptionCalldata);
  assert.equal(verified.authorizationOwner, null);
});

test("outer verifier rejects tampered chain, payer, type, and signed payload", async () => {
  const intent = makeIntent("outer-tamper", "empty");
  const [legacy, access, blob] = await Promise.all([signedOuter(0), signedOuter(1), signedOuter(3)]);
  await assert.rejects(verifyMetaMaskOuterTransaction({ ...access.raw, chainId: "0x1" }, access.hash, intent), protocolError);
  await assert.rejects(verifyMetaMaskOuterTransaction({ ...legacy.raw,
    from: "0x4444444444444444444444444444444444444444" }, legacy.hash, intent), protocolError);
  await assert.rejects(verifyMetaMaskOuterTransaction({ ...blob.raw, type: "0x2" }, blob.hash, intent), protocolError);
  await assert.rejects(verifyMetaMaskOuterTransaction({ ...access.raw, input: "0x12345678" }, access.hash, intent), protocolError);
});

async function signedOuter(type: 0 | 1 | 3): Promise<{ readonly hash: Hex; readonly raw: Json }> {
  const common: TransactionRequest = { type, chainId: 8453, nonce: 7, gasLimit: 600_000n,
    to: mmRegistry(8453).row.protocol.manager.address, value: 0n, data: vector.redemptionCalldata };
  const request: TransactionRequest = type === 0 ? { ...common, gasPrice: 2_000_000_000n } :
    type === 1 ? { ...common, gasPrice: 2_000_000_000n, accessList: [] } :
      { ...common, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 100_000_000n,
        accessList: [], maxFeePerBlobGas: 100n, blobVersionedHashes: [blobHash] };
  const transaction = Transaction.from(await payer.signTransaction(request));
  assert.notEqual(transaction.hash, null); assert.notEqual(transaction.from, null); assert.notEqual(transaction.signature, null);
  const signature = transaction.signature!;
  const raw: Json = { hash: transaction.hash, chainId: quantity(transaction.chainId), type: quantity(type),
    nonce: quantity(transaction.nonce), from: transaction.from!.toLowerCase(), to: transaction.to!.toLowerCase(),
    gas: quantity(transaction.gasLimit), value: quantity(transaction.value), input: transaction.data.toLowerCase(),
    r: signature.r.toLowerCase(), s: signature.s.toLowerCase(),
    v: quantity(type === 0 ? signature.networkV! : signature.yParity),
    ...(type === 0 ? { gasPrice: quantity(transaction.gasPrice!) } : {
      yParity: quantity(signature.yParity), accessList: transaction.accessList ?? [],
      ...(type === 1 ? { gasPrice: quantity(transaction.gasPrice!) } : {
        maxFeePerGas: quantity(transaction.maxFeePerGas!),
        maxPriorityFeePerGas: quantity(transaction.maxPriorityFeePerGas!),
        maxFeePerBlobGas: quantity(transaction.maxFeePerBlobGas!),
        blobVersionedHashes: transaction.blobVersionedHashes,
      }),
    }),
  };
  return { hash: transaction.hash as Hex, raw };
}

const protocolError = { code: "APN_RPC_PROTOCOL" };
