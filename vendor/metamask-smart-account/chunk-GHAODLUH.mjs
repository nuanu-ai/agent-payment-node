import { createRequire as __apnSdkCreateRequire, isBuiltin as __apnSdkIsBuiltin } from "node:module"; const __apnSdkRequire = __apnSdkCreateRequire(import.meta.url); const require = (name) => { if (typeof name !== "string" || !__apnSdkIsBuiltin(name)) throw new Error("APN SDK refuses non-builtin dynamic require"); return __apnSdkRequire(name); };
import {
  __export,
  abi11 as abi4,
  abi19 as abi5,
  abi2 as abi,
  abi4 as abi2,
  abi8 as abi3,
  bytecode,
  dist_exports,
  encodeExecutionCalldata,
  getCode,
  readContract,
  simulateContract,
  toDelegationStruct,
  writeContract
} from "./chunk-XRTWDKRZ.mjs";
import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  encodeDeployData,
  encodeFunctionData,
  formatAbiItemWithArgs,
  isHex
} from "./chunk-S2MT4VX5.mjs";

// node_modules/@metamask/smart-accounts-kit/dist/chunk-5ENRJKXL.mjs
var read_exports = {};
__export(read_exports, {
  getDelegationManager: () => read,
  getDeposit: () => read2,
  getEntryPoint: () => read3,
  getNonce: () => read4,
  getProxyImplementation: () => read5,
  getProxyVersion: () => read6,
  isValidSignature: () => read7
});
var read = async ({
  client,
  contractAddress
}) => await readContract(client, {
  address: contractAddress,
  abi,
  functionName: "delegationManager"
});
var read2 = async ({
  client,
  contractAddress
}) => await readContract(client, {
  address: contractAddress,
  abi,
  functionName: "getDeposit"
});
var read3 = async ({
  client,
  contractAddress
}) => await readContract(client, {
  address: contractAddress,
  abi,
  functionName: "entryPoint"
});
var read4 = async ({
  client,
  contractAddress,
  key
}) => await readContract(client, {
  address: contractAddress,
  abi,
  functionName: "getNonce",
  args: key ? [key] : void 0
});
var read5 = async ({
  client,
  contractAddress
}) => await readContract(client, {
  address: contractAddress,
  abi,
  functionName: "getImplementation"
});
var read6 = async ({
  client,
  contractAddress
}) => await readContract(client, {
  address: contractAddress,
  abi,
  functionName: "getInitializedVersion"
});
var read7 = async ({
  client,
  contractAddress,
  hash,
  signature
}) => await readContract(client, {
  address: contractAddress,
  abi,
  functionName: "isValidSignature",
  args: [hash, signature]
});
var encode = ({
  hash,
  signature
}) => {
  return encodeFunctionData({
    abi,
    functionName: "isValidSignature",
    args: [hash, signature]
  });
};
async function isContractDeployed({
  client,
  contractAddress
}) {
  const code = await getCode(client, {
    address: contractAddress
  });
  return Boolean(code) && code !== "0x";
}
async function isImplementationExpected({
  client,
  contractAddress,
  expectedImplementationAddress
}) {
  if (!await isContractDeployed({ client, contractAddress })) {
    return false;
  }
  const implementationAddress = await read5({
    client,
    contractAddress
  });
  return implementationAddress === expectedImplementationAddress;
}
var encodeProxyCreationCode = ({
  implementationAddress,
  initcode
}) => encodeDeployData({
  abi: abi2,
  args: [implementationAddress, initcode],
  bytecode
});
var knownRevertAbis = Object.values(dist_exports).filter(
  (abi6) => abi6.length > 0
);
var standardSolidityErrorAbi = [];
var revertReasonAbis = [
  standardSolidityErrorAbi,
  ...knownRevertAbis
];
var MAX_ERROR_TRAVERSAL_DEPTH = 8;
var panicReasons = {
  "1": "An `assert` condition failed.",
  "17": "Arithmetic operation resulted in underflow or overflow.",
  "18": "Division or modulo by zero.",
  "33": "Attempted to convert to an invalid type.",
  "34": "Attempted to access a storage byte array that is incorrectly encoded.",
  "49": "Performed `.pop()` on an empty array.",
  "50": "Array index is out of bounds.",
  "65": "Allocated too much memory or created an array which is too large.",
  "81": "Attempted to call a zero-initialized variable of internal function type."
};
function decodeRevertReason(error) {
  const decodedViemError = decodeViemContractRevert(error);
  if (decodedViemError) {
    return decodedViemError;
  }
  for (const rawData of getRevertDataCandidates(error)) {
    const decoded = decodeRevertData(rawData);
    if (decoded) {
      return decoded;
    }
  }
  return void 0;
}
function decodeViemContractRevert(error) {
  if (!(error instanceof BaseError)) {
    return void 0;
  }
  const revertError = error.walk(
    (cause) => cause instanceof ContractFunctionRevertedError
  );
  if (!(revertError instanceof ContractFunctionRevertedError)) {
    return void 0;
  }
  if (!revertError.raw) {
    return void 0;
  }
  if (revertError.data) {
    const { abiItem, args, errorName } = revertError.data;
    return {
      errorName,
      message: formatDecodedError(errorName, args, abiItem),
      rawData: revertError.raw
    };
  }
  return decodeRevertData(revertError.raw);
}
function decodeRevertData(rawData) {
  for (const abi6 of revertReasonAbis) {
    try {
      const { abiItem, args, errorName } = decodeErrorResult({
        abi: abi6,
        data: rawData
      });
      return {
        errorName,
        message: formatDecodedError(errorName, args, abiItem),
        rawData
      };
    } catch {
    }
  }
  const decodedString = decodeRawString(rawData);
  if (decodedString) {
    return {
      errorName: "Error",
      message: decodedString,
      rawData
    };
  }
  return void 0;
}
function formatDecodedError(errorName, args, abiItem) {
  const [firstArg] = args ?? [];
  if (errorName === "Error") {
    return typeof firstArg === "string" ? firstArg : errorName;
  }
  if (errorName === "Panic") {
    const panicCode = String(firstArg);
    return panicReasons[panicCode] ?? `Panic(${panicCode})`;
  }
  const formattedArgs = formatAbiItemWithArgs({
    abiItem,
    args: args ?? [],
    includeFunctionName: false,
    includeName: false
  });
  return `${errorName}${formattedArgs ?? ""}`;
}
function decodeRawString(rawData) {
  const bytes = rawData.slice(2);
  if (bytes.length === 0 || bytes.length % 2 !== 0) {
    return void 0;
  }
  let value = "";
  for (let index = 0; index < bytes.length; index += 2) {
    const charCode = Number.parseInt(bytes.slice(index, index + 2), 16);
    if (Number.isNaN(charCode) || charCode < 32 || charCode > 126) {
      return void 0;
    }
    value += String.fromCharCode(charCode);
  }
  return value;
}
function getRevertDataCandidates(error) {
  const candidates = [];
  const seen = /* @__PURE__ */ new Set();
  const seenCandidates = /* @__PURE__ */ new Set();
  const addHexCandidate = (candidate) => {
    if (candidate.length < 10 || candidate.length % 2 !== 0 || !isHex(candidate)) {
      return;
    }
    if (!seenCandidates.has(candidate)) {
      seenCandidates.add(candidate);
      candidates.push(candidate);
    }
  };
  const addLabeledHexCandidates = (value) => {
    for (const match of value.matchAll(
      /\b(?:reason|revertData|raw|data):\s*(0x[0-9a-fA-F]+)/giu
    )) {
      const [, candidate] = match;
      if (candidate) {
        addHexCandidate(candidate);
      }
    }
  };
  const addHexCandidates = (value) => {
    if (typeof value !== "string") {
      return;
    }
    addLabeledHexCandidates(value);
    for (const [candidate] of value.matchAll(/0x[0-9a-fA-F]+/gu)) {
      addHexCandidate(candidate);
    }
  };
  const visit = (value, depth = 0) => {
    if (value === null || value === void 0 || seen.has(value) || depth > MAX_ERROR_TRAVERSAL_DEPTH) {
      return;
    }
    addHexCandidates(value);
    if (Array.isArray(value)) {
      seen.add(value);
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    if (typeof value !== "object") {
      return;
    }
    seen.add(value);
    const record = value;
    addHexCandidates(record.revertData);
    addHexCandidates(record.raw);
    addHexCandidates(record.data);
    addHexCandidates(record.details);
    addHexCandidates(record.reason);
    addHexCandidates(record.shortMessage);
    addHexCandidates(record.message);
    visit(record.data, depth + 1);
    visit(record.details, depth + 1);
    visit(record.error, depth + 1);
    visit(record.metaMessages, depth + 1);
    visit(record.originalError, depth + 1);
    visit(record.cause, depth + 1);
  };
  visit(error);
  return candidates;
}
var simulate = async ({
  client,
  hybridDeleGatorAddress,
  eoaOwner,
  p256Owners
}) => {
  return simulateContract(client, {
    address: hybridDeleGatorAddress,
    abi: abi3,
    functionName: "initialize",
    args: [
      eoaOwner,
      p256Owners.map((p256Owner) => p256Owner.keyId),
      p256Owners.map((p256Owner) => p256Owner.x),
      p256Owners.map((p256Owner) => p256Owner.y)
    ]
  });
};
var encode2 = ({
  eoaOwner,
  p256Owners
}) => {
  return encodeFunctionData({
    abi: abi3,
    functionName: "initialize",
    args: [
      eoaOwner,
      p256Owners.map((p256Owner) => p256Owner.keyId),
      p256Owners.map((p256Owner) => p256Owner.x),
      p256Owners.map((p256Owner) => p256Owner.y)
    ]
  });
};
var encode_exports = {};
__export(encode_exports, {
  addKey: () => encode3,
  initializeHybridDeleGator: () => encode2,
  reinitializeHybridDeleGator: () => encode4,
  removeKey: () => encode5,
  updateSigners: () => encode6
});
var simulate2 = async ({
  client,
  hybridDeleGatorAddress,
  p256Owner
}) => {
  return simulateContract(client, {
    address: hybridDeleGatorAddress,
    abi: abi3,
    functionName: "addKey",
    args: [p256Owner.keyId, p256Owner.x, p256Owner.y]
  });
};
var encode3 = ({ p256Owner }) => {
  return encodeFunctionData({
    abi: abi3,
    functionName: "addKey",
    args: [p256Owner.keyId, p256Owner.x, p256Owner.y]
  });
};
var simulate3 = async ({
  client,
  hybridDeleGatorAddress,
  version,
  eoaOwner,
  p256Owners,
  removeExistingP256Owners
}) => {
  return simulateContract(client, {
    address: hybridDeleGatorAddress,
    abi: abi3,
    functionName: "reinitialize",
    args: [
      version,
      eoaOwner,
      p256Owners.map((p256Owner) => p256Owner.keyId),
      p256Owners.map((p256Owner) => p256Owner.x),
      p256Owners.map((p256Owner) => p256Owner.y),
      removeExistingP256Owners
    ]
  });
};
var encode4 = ({
  version,
  eoaOwner,
  p256Owners,
  removeExistingP256Owners
}) => {
  return encodeFunctionData({
    abi: abi3,
    functionName: "reinitialize",
    args: [
      version,
      eoaOwner,
      p256Owners.map((p256Owner) => p256Owner.keyId),
      p256Owners.map((p256Owner) => p256Owner.x),
      p256Owners.map((p256Owner) => p256Owner.y),
      removeExistingP256Owners
    ]
  });
};
var simulate4 = async ({
  client,
  hybridDeleGatorAddress,
  keyId
}) => {
  return simulateContract(client, {
    address: hybridDeleGatorAddress,
    abi: abi3,
    functionName: "removeKey",
    args: [keyId]
  });
};
var encode5 = ({ keyId }) => {
  return encodeFunctionData({
    abi: abi3,
    functionName: "removeKey",
    args: [keyId]
  });
};
var simulate5 = async ({
  client,
  hybridDeleGatorAddress,
  eoaOwner,
  p256Owners
}) => {
  return simulateContract(client, {
    address: hybridDeleGatorAddress,
    abi: abi3,
    functionName: "updateSigners",
    args: [
      eoaOwner,
      p256Owners.map((p256Owner) => p256Owner.keyId),
      p256Owners.map((p256Owner) => p256Owner.x),
      p256Owners.map((p256Owner) => p256Owner.y)
    ]
  });
};
var encode6 = ({
  eoaOwner,
  p256Owners
}) => {
  return encodeFunctionData({
    abi: abi3,
    functionName: "updateSigners",
    args: [
      eoaOwner,
      p256Owners.map((p256Owner) => p256Owner.keyId),
      p256Owners.map((p256Owner) => p256Owner.x),
      p256Owners.map((p256Owner) => p256Owner.y)
    ]
  });
};
var simulate6 = async ({
  client,
  multiSigDeleGatorAddress,
  owners,
  threshold
}) => {
  return simulateContract(client, {
    address: multiSigDeleGatorAddress,
    abi: abi4,
    functionName: "initialize",
    args: [owners, threshold]
  });
};
var encode7 = ({ owners, threshold }) => {
  return encodeFunctionData({
    abi: abi4,
    functionName: "initialize",
    args: [owners, threshold]
  });
};
var encode_exports2 = {};
__export(encode_exports2, {
  addSigner: () => encode8,
  initializeMultiSigDeleGator: () => encode7,
  reinitializeMultiSigDeleGator: () => encode9,
  removeSigner: () => encode10,
  replaceSigner: () => encode11,
  updateMultiSigParameters: () => encode12,
  updateThreshold: () => encode13
});
var simulate7 = async ({
  client,
  multiSigDeleGatorAddress,
  signer
}) => {
  return simulateContract(client, {
    address: multiSigDeleGatorAddress,
    abi: abi4,
    functionName: "addSigner",
    args: [signer]
  });
};
var encode8 = ({ signer }) => {
  return encodeFunctionData({
    abi: abi4,
    functionName: "addSigner",
    args: [signer]
  });
};
var simulate8 = async ({
  client,
  multiSigDeleGatorAddress,
  version,
  owners,
  threshold,
  removeExistingOwners
}) => {
  return simulateContract(client, {
    address: multiSigDeleGatorAddress,
    abi: abi4,
    functionName: "reinitialize",
    args: [version, owners, threshold, removeExistingOwners]
  });
};
var encode9 = ({
  version,
  owners,
  threshold,
  removeExistingOwners
}) => {
  return encodeFunctionData({
    abi: abi4,
    functionName: "reinitialize",
    args: [version, owners, threshold, removeExistingOwners]
  });
};
var simulate9 = async ({
  client,
  multiSigDeleGatorAddress,
  signer
}) => {
  return simulateContract(client, {
    address: multiSigDeleGatorAddress,
    abi: abi4,
    functionName: "removeSigner",
    args: [signer]
  });
};
var encode10 = ({ signer }) => {
  return encodeFunctionData({
    abi: abi4,
    functionName: "removeSigner",
    args: [signer]
  });
};
var simulate10 = async ({
  client,
  multiSigDeleGatorAddress,
  oldSigner,
  newSigner
}) => {
  return simulateContract(client, {
    address: multiSigDeleGatorAddress,
    abi: abi4,
    functionName: "replaceSigner",
    args: [oldSigner, newSigner]
  });
};
var encode11 = ({
  oldSigner,
  newSigner
}) => {
  return encodeFunctionData({
    abi: abi4,
    functionName: "replaceSigner",
    args: [oldSigner, newSigner]
  });
};
var simulate11 = async ({
  client,
  multiSigDeleGatorAddress,
  owners,
  threshold,
  removeExistingOwners
}) => {
  return simulateContract(client, {
    address: multiSigDeleGatorAddress,
    abi: abi4,
    functionName: "updateMultiSigParameters",
    args: [owners, threshold, removeExistingOwners]
  });
};
var encode12 = ({
  owners,
  threshold,
  removeExistingOwners
}) => {
  return encodeFunctionData({
    abi: abi4,
    functionName: "updateMultiSigParameters",
    args: [owners, threshold, removeExistingOwners]
  });
};
var simulate12 = async ({
  client,
  multiSigDeleGatorAddress,
  threshold
}) => {
  return simulateContract(client, {
    address: multiSigDeleGatorAddress,
    abi: abi4,
    functionName: "updateThreshold",
    args: [threshold]
  });
};
var encode13 = ({ threshold }) => {
  return encodeFunctionData({
    abi: abi4,
    functionName: "updateThreshold",
    args: [threshold]
  });
};
var simulate13 = async ({
  client,
  factoryAddress,
  creationCode,
  salt
}) => {
  return simulateContract(client, {
    address: factoryAddress,
    abi: abi5,
    functionName: "deploy",
    args: [creationCode, salt]
  });
};
var encode14 = (creationCode, salt) => {
  return encodeFunctionData({
    abi: abi5,
    functionName: "deploy",
    args: [creationCode, salt]
  });
};
var execute = async ({
  client,
  factoryAddress,
  creationCode,
  salt
}) => {
  const { request } = await simulate13({
    client,
    factoryAddress,
    creationCode,
    salt
  });
  return writeContract(client, request);
};
var encode_exports3 = {};
__export(encode_exports3, {
  create2Deploy: () => encode14
});
var simulate14 = async ({
  client,
  contractAddress,
  execution
}) => {
  return simulateContract(client, {
    address: contractAddress,
    abi,
    functionName: "execute",
    args: [execution]
  });
};
var execute2 = async ({
  client,
  contractAddress,
  execution
}) => {
  const { request } = await simulate14({
    client,
    contractAddress,
    execution
  });
  return writeContract(client, request);
};
var encode15 = ({ execution }) => {
  return encodeFunctionData({
    abi,
    functionName: "execute",
    args: [execution]
  });
};
var simulate15 = async ({
  client,
  contractAddress,
  mode,
  executions
}) => {
  return simulateContract(client, {
    address: contractAddress,
    abi,
    functionName: "execute",
    args: [mode, encodeExecutionCalldata(executions)]
  });
};
var execute3 = async ({
  client,
  contractAddress,
  mode,
  executions
}) => {
  const { request } = await simulate15({
    client,
    contractAddress,
    mode,
    executions
  });
  return writeContract(client, request);
};
var encode16 = ({
  mode,
  executions
}) => {
  return encodeFunctionData({
    abi,
    functionName: "execute",
    args: [mode, encodeExecutionCalldata(executions)]
  });
};
var encode_exports4 = {};
__export(encode_exports4, {
  disableDelegation: () => encode17,
  enableDelegation: () => encode18,
  execute: () => encode15,
  executeWithMode: () => encode16,
  isValidSignature: () => encode,
  upgradeToAndCall: () => encode19
});
var simulate16 = async ({
  client,
  delegationManagerAddress,
  delegation
}) => {
  const delegationStruct = toDelegationStruct(delegation);
  return simulateContract(client, {
    address: delegationManagerAddress,
    abi,
    functionName: "disableDelegation",
    args: [delegationStruct]
  });
};
var execute4 = async ({
  client,
  delegationManagerAddress,
  delegation
}) => {
  const { request } = await simulate16({
    client,
    delegationManagerAddress,
    delegation
  });
  return writeContract(client, request);
};
var encode17 = ({ delegation }) => {
  const delegationStruct = toDelegationStruct(delegation);
  return encodeFunctionData({
    abi,
    functionName: "disableDelegation",
    args: [delegationStruct]
  });
};
var simulate17 = async ({
  client,
  delegationManagerAddress,
  delegation
}) => {
  const delegationStruct = toDelegationStruct(delegation);
  return simulateContract(client, {
    address: delegationManagerAddress,
    abi,
    functionName: "enableDelegation",
    args: [delegationStruct]
  });
};
var execute5 = async ({
  client,
  delegationManagerAddress,
  delegation
}) => {
  const { request } = await simulate17({
    client,
    delegationManagerAddress,
    delegation
  });
  return writeContract(client, request);
};
var encode18 = ({ delegation }) => {
  const delegationStruct = toDelegationStruct(delegation);
  return encodeFunctionData({
    abi,
    functionName: "enableDelegation",
    args: [delegationStruct]
  });
};
var simulate18 = async ({
  client,
  contractAddress,
  implementation,
  data
}) => {
  return simulateContract(client, {
    address: contractAddress,
    abi,
    functionName: "upgradeToAndCall",
    args: [implementation, data]
  });
};
var execute6 = async ({
  client,
  contractAddress,
  implementation,
  data
}) => {
  const { request } = await simulate18({
    client,
    contractAddress,
    implementation,
    data
  });
  return writeContract(client, request);
};
var encode19 = ({
  implementation,
  data
}) => {
  return encodeFunctionData({
    abi,
    functionName: "upgradeToAndCall",
    args: [implementation, data]
  });
};

export {
  read_exports,
  isContractDeployed,
  isImplementationExpected,
  encodeProxyCreationCode,
  decodeRevertReason,
  simulate,
  encode_exports,
  simulate2,
  simulate3,
  simulate4,
  simulate5,
  simulate6,
  encode_exports2,
  simulate7,
  simulate8,
  simulate9,
  simulate10,
  simulate11,
  simulate12,
  simulate13,
  execute,
  encode_exports3,
  simulate14,
  execute2,
  simulate15,
  execute3,
  encode_exports4,
  simulate16,
  execute4,
  simulate17,
  execute5,
  simulate18,
  execute6
};
