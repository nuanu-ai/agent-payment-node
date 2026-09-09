import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";

// These public fixture keys exist only in the external test harness. They never
// enter the package, a real provider, or APN's persistent wallet storage.
const OWNER_KEY = `0x${"11".repeat(32)}`;
const RELAYER_KEY = `0x${"33".repeat(32)}`;
const types = {
  Caveat: [{ name: "enforcer", type: "address" }, { name: "terms", type: "bytes" }],
  Delegation: [{ name: "delegate", type: "address" }, { name: "delegator", type: "address" },
    { name: "authority", type: "bytes32" }, { name: "caveats", type: "Caveat[]" }, { name: "salt", type: "uint256" }],
};
const DELEGATIONS = "tuple(address delegate,address delegator,bytes32 authority,tuple(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt,bytes signature)[]";
const EXECUTIONS = "tuple(address target,uint256 value,bytes callData)[]";
const batchMode = `0x01${"00".repeat(31)}`;
const quantity = value => `0x${BigInt(value).toString(16)}`;
const word = value => `0x${BigInt(value).toString(16).padStart(64, "0")}`;
const addressWord = address => `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
export const fixtureBlockHash = (chain, number) => `0x${createHash("sha256").update(`mm-installed-${chain}-${number}`).digest("hex")}`;

function ethersAt(packageRoot) { return createRequire(join(packageRoot, "package.json"))("ethers"); }
export function syntheticWallets(packageRoot) {
  const { Wallet } = ethersAt(packageRoot);
  return { owner: new Wallet(OWNER_KEY).address.toLowerCase(), relayer: new Wallet(RELAYER_KEY).address.toLowerCase() };
}

/** Independent ethers signing and ABI construction; no production codec is called. */
export async function makeSignedEffect(packageRoot, fixture, posted, { nonce = 7, blockNumber = 102, type = 4 } = {}) {
  const { Wallet, TypedDataEncoder, AbiCoder, Interface, Transaction, id } = ethersAt(packageRoot);
  const owner = new Wallet(OWNER_KEY), relayer = new Wallet(RELAYER_KEY), row = fixture.row;
  assert.deepEqual(Object.keys(posted).sort(), ["delegation", "encoding", "executions", "method", "requestId", "tx"]);
  assert.equal(posted.method, "eth_sendRelayTransaction"); assert.equal(posted.encoding, "redeemDelegations");
  assert.deepEqual(posted.tx, { from: owner.address.toLowerCase(), chainId: row.chainId });
  const delegation = { ...posted.delegation, salt: BigInt(posted.delegation.salt),
    caveats: posted.delegation.caveats.map(caveat => ({ ...caveat, args: caveat.args ?? "0x" })) };
  const domain = { name: "DelegationManager", version: "1", chainId: row.chainId, verifyingContract: row.protocol.manager.address };
  const signingDigest = TypedDataEncoder.hash(domain, types, delegation);
  const delegationHash = TypedDataEncoder.hashStruct("Delegation", types, delegation);
  const signature = await owner.signTypedData(domain, types, delegation);
  const abi = AbiCoder.defaultAbiCoder(), transfer = new Interface(["function transfer(address to,uint256 value) returns (bool)"]);
  const executions = posted.executions.map(execution => ({ ...execution, value: BigInt(execution.value ?? 0) }));
  assert.equal(executions.length, 2);
  const amounts = executions.map((execution, index) => {
    assert.equal(execution.target.toLowerCase(), row.token); assert.equal(execution.value, 0n);
    const args = transfer.decodeFunctionData("transfer", execution.callData);
    assert.equal(args[0].toLowerCase(), index === 0 ? fixture.recipient : fixture.feeRecipient);
    return args[1];
  });
  const context = abi.encode([DELEGATIONS], [[{ ...delegation, signature }]]);
  const executionData = abi.encode([EXECUTIONS], [executions]);
  const manager = new Interface(["function redeemDelegations(bytes[] permissionContexts,bytes32[] modes,bytes[] executionCallDatas)"]);
  const calldata = manager.encodeFunctionData("redeemDelegations", [[context], [batchMode], [executionData]]);
  const auth = type === 4 ? await owner.authorize({ address: row.protocol.delegate.address, chainId: row.chainId, nonce: 1 }) : null;
  const request = { type, chainId: row.chainId, nonce, to: row.protocol.manager.address, value: 0n,
    gasLimit: 700000n, maxFeePerGas: 2000000000n, maxPriorityFeePerGas: 100000000n, data: calldata,
    accessList: [], ...(auth === null ? {} : { authorizationList: [auth] }) };
  const parsed = Transaction.from(await relayer.signTransaction(request)), sig = parsed.signature;
  const blockHash = fixtureBlockHash(row.chainId, blockNumber);
  const transaction = { hash: parsed.hash, chainId: quantity(row.chainId), type: quantity(type), nonce: quantity(nonce),
    from: relayer.address.toLowerCase(), to: row.protocol.manager.address, gas: quantity(parsed.gasLimit), value: "0x0",
    input: parsed.data, r: sig.r, s: sig.s, v: quantity(sig.yParity), yParity: quantity(sig.yParity), accessList: [],
    maxFeePerGas: quantity(parsed.maxFeePerGas), maxPriorityFeePerGas: quantity(parsed.maxPriorityFeePerGas),
    blockNumber: quantity(blockNumber), blockHash, transactionIndex: "0x0",
    ...(auth === null ? {} : { authorizationList: [{ chainId: quantity(auth.chainId), address: auth.address.toLowerCase(),
      nonce: quantity(auth.nonce), r: auth.signature.r, s: auth.signature.s, yParity: quantity(auth.signature.yParity) }] }) };
  const common = { blockNumber: quantity(blockNumber), blockHash, transactionHash: parsed.hash,
    transactionIndex: "0x0", removed: false };
  const logs = [{ ...common, address: row.protocol.limitedCalls.address, logIndex: "0x0",
    topics: [id("IncreasedCount(address,address,bytes32,uint256,uint256)"), addressWord(row.protocol.manager.address),
      addressWord(relayer.address), delegationHash], data: word(1n) + word(1n).slice(2) },
  ...amounts.map((amount, index) => ({ ...common, address: row.token, logIndex: quantity(index + 1),
    topics: [id("Transfer(address,address,uint256)"), addressWord(owner.address),
      addressWord(index === 0 ? fixture.recipient : fixture.feeRecipient)], data: word(amount) }))];
  const receipt = { ...common, type: quantity(type), from: relayer.address.toLowerCase(), to: row.protocol.manager.address,
    status: "0x1", logs };
  return { transaction, receipt, delegationHash, signingDigest, requestId: posted.requestId, posted,
    deliveredAtomic: amounts[0].toString(), feeAtomic: amounts[1].toString(), debitAtomic: (amounts[0] + amounts[1]).toString() };
}
