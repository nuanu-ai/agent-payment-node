import { createRequire as __apnSdkCreateRequire, isBuiltin as __apnSdkIsBuiltin } from "node:module"; const __apnSdkRequire = __apnSdkCreateRequire(import.meta.url); const require = (name) => { if (typeof name !== "string" || !__apnSdkIsBuiltin(name)) throw new Error("APN SDK refuses non-builtin dynamic require"); return __apnSdkRequire(name); };
import {
  ERC20PeriodTransferEnforcer_exports,
  ERC20StreamingEnforcer_exports,
  MultiTokenPeriodEnforcer_exports,
  NativeTokenPeriodTransferEnforcer_exports,
  NativeTokenStreamingEnforcer_exports
} from "./chunk-KV33L6SU.mjs";
import {
  decodeRevertReason,
  encodeProxyCreationCode,
  encode_exports,
  encode_exports2,
  encode_exports3,
  encode_exports4,
  execute,
  execute2,
  execute3,
  execute4,
  execute5,
  execute6,
  isContractDeployed,
  isImplementationExpected,
  read_exports,
  simulate,
  simulate10,
  simulate11,
  simulate12,
  simulate13,
  simulate14,
  simulate15,
  simulate16,
  simulate17,
  simulate18,
  simulate2,
  simulate3,
  simulate4,
  simulate5,
  simulate6,
  simulate7,
  simulate8,
  simulate9
} from "./chunk-GHAODLUH.mjs";
import {
  __export,
  abi,
  abi10 as abi6,
  abi11 as abi7,
  abi15 as abi8,
  abi16 as abi9,
  abi17 as abi10,
  abi18 as abi11,
  abi19 as abi12,
  abi20 as abi13,
  abi3 as abi2,
  abi7 as abi3,
  abi8 as abi4,
  abi9 as abi5,
  encodeDelegations,
  encodeExecutionCalldatas,
  readContract,
  simulateContract,
  toDelegationStruct,
  writeContract
} from "./chunk-XRTWDKRZ.mjs";
import {
  encodeFunctionData
} from "./chunk-S2MT4VX5.mjs";
import {
  ANY_BENEFICIARY,
  ROOT_AUTHORITY
} from "./chunk-GFNUYFFY.mjs";

// node_modules/@metamask/smart-accounts-kit/dist/chunk-RDTAD64U.mjs
var contracts_exports = {};
__export(contracts_exports, {
  DeleGatorCore: () => DeleGatorCore_exports,
  DelegationManager: () => DelegationManager_exports,
  EIP712: () => EIP712_exports,
  ERC20PeriodTransferEnforcer: () => ERC20PeriodTransferEnforcer_exports,
  ERC20StreamingEnforcer: () => ERC20StreamingEnforcer_exports,
  ERC20TransferAmountEnforcer: () => ERC20TransferAmountEnforcer_exports,
  EntryPoint: () => EntryPoint_exports,
  HybridDeleGator: () => HybridDeleGator_exports,
  IdEnforcer: () => IdEnforcer_exports,
  LimitedCallsEnforcer: () => LimitedCallsEnforcer_exports,
  MultiSigDeleGator: () => MultiSigDeleGator_exports,
  MultiTokenPeriodEnforcer: () => MultiTokenPeriodEnforcer_exports,
  NativeTokenPeriodTransferEnforcer: () => NativeTokenPeriodTransferEnforcer_exports,
  NativeTokenStreamingEnforcer: () => NativeTokenStreamingEnforcer_exports,
  NativeTokenTransferAmountEnforcer: () => NativeTokenTransferAmountEnforcer_exports,
  NonceEnforcer: () => NonceEnforcer_exports,
  Ownable2Step: () => Ownable2Step_exports,
  Pausable: () => Pausable_exports,
  SimpleFactory: () => SimpleFactory_exports,
  SpecificActionERC20TransferBatchEnforcer: () => SpecificActionERC20TransferBatchEnforcer_exports,
  encodeProxyCreationCode: () => encodeProxyCreationCode,
  isContractDeployed: () => isContractDeployed,
  isImplementationExpected: () => isImplementationExpected
});
var DelegationManager_exports = {};
__export(DelegationManager_exports, {
  constants: () => constants_exports,
  decode: () => decode_exports,
  encode: () => encode_exports5,
  execute: () => execute_exports,
  read: () => read_exports2,
  simulate: () => simulate_exports
});
var constants_exports = {};
__export(constants_exports, {
  ANY_BENEFICIARY: () => ANY_BENEFICIARY,
  DOMAIN_VERSION: () => DOMAIN_VERSION,
  NAME: () => NAME,
  ROOT_AUTHORITY: () => ROOT_AUTHORITY,
  VERSION: () => VERSION
});
var NAME = "DelegationManager";
var VERSION = "1.3.0";
var DOMAIN_VERSION = "1";
var decode_exports = {};
__export(decode_exports, {
  redeemDelegationsError: () => decodeError
});
var simulate19 = async ({
  client,
  delegationManagerAddress,
  delegations,
  modes,
  executions
}) => {
  return simulateContract(client, {
    address: delegationManagerAddress,
    abi,
    functionName: "redeemDelegations",
    args: [
      delegations.map((delegationChain) => encodeDelegations(delegationChain)),
      modes,
      encodeExecutionCalldatas(executions)
    ]
  });
};
var execute7 = async ({
  client,
  delegationManagerAddress,
  delegations,
  modes,
  executions
}) => {
  const { request } = await simulate19({
    client,
    delegationManagerAddress,
    delegations,
    modes,
    executions
  });
  return writeContract(client, request);
};
var encode = ({
  delegations,
  modes,
  executions
}) => {
  return encodeFunctionData({
    abi,
    functionName: "redeemDelegations",
    args: [
      delegations.map((delegationChain) => encodeDelegations(delegationChain)),
      modes,
      encodeExecutionCalldatas(executions)
    ]
  });
};
var decodeError = (error) => decodeRevertReason(error);
var encode_exports5 = {};
__export(encode_exports5, {
  disableDelegation: () => encode2,
  enableDelegation: () => encode3,
  redeemDelegations: () => encode
});
var simulate20 = async ({
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
var execute8 = async ({
  client,
  delegationManagerAddress,
  delegation
}) => {
  const { request } = await simulate20({
    client,
    delegationManagerAddress,
    delegation
  });
  return writeContract(client, request);
};
var encode2 = ({ delegation }) => {
  const delegationStruct = toDelegationStruct(delegation);
  return encodeFunctionData({
    abi,
    functionName: "disableDelegation",
    args: [delegationStruct]
  });
};
var simulate21 = async ({
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
var execute9 = async ({
  client,
  delegationManagerAddress,
  delegation
}) => {
  const { request } = await simulate21({
    client,
    delegationManagerAddress,
    delegation
  });
  return writeContract(client, request);
};
var encode3 = ({ delegation }) => {
  const delegationStruct = toDelegationStruct(delegation);
  return encodeFunctionData({
    abi,
    functionName: "enableDelegation",
    args: [delegationStruct]
  });
};
var execute_exports = {};
__export(execute_exports, {
  disableDelegation: () => execute8,
  enableDelegation: () => execute9,
  redeemDelegations: () => execute7
});
var read_exports2 = {};
__export(read_exports2, {
  disabledDelegations: () => read,
  getAnyDelegate: () => read2,
  getRootAuthority: () => read3
});
var read = async ({
  client,
  contractAddress,
  delegationHash
}) => await readContract(client, {
  address: contractAddress,
  abi,
  functionName: "disabledDelegations",
  args: [delegationHash]
});
var read2 = async ({
  client,
  contractAddress
}) => await readContract(client, {
  address: contractAddress,
  abi,
  functionName: "ANY_DELEGATE"
});
var read3 = async ({
  client,
  contractAddress
}) => await readContract(client, {
  address: contractAddress,
  abi,
  functionName: "ROOT_AUTHORITY"
});
var simulate_exports = {};
__export(simulate_exports, {
  disableDelegation: () => simulate20,
  enableDelegation: () => simulate21,
  redeemDelegations: () => simulate19
});
var DeleGatorCore_exports = {};
__export(DeleGatorCore_exports, {
  encode: () => encode_exports4,
  execute: () => execute_exports2,
  read: () => read_exports,
  simulate: () => simulate_exports2
});
var execute_exports2 = {};
__export(execute_exports2, {
  disableDelegation: () => execute4,
  enableDelegation: () => execute5,
  execute: () => execute2,
  executeWithMode: () => execute3,
  upgradeToAndCall: () => execute6
});
var simulate_exports2 = {};
__export(simulate_exports2, {
  disableDelegation: () => simulate16,
  enableDelegation: () => simulate17,
  execute: () => simulate14,
  executeWithMode: () => simulate15,
  upgradeToAndCall: () => simulate18
});
var EIP712_exports = {};
__export(EIP712_exports, {
  read: () => read_exports3
});
var read_exports3 = {};
__export(read_exports3, {
  getContractName: () => read4,
  getContractVersion: () => read5,
  getDomainVersion: () => read6
});
var read4 = async ({
  client,
  contractAddress
}) => await readContract(client, {
  address: contractAddress,
  abi: [
    {
      type: "function",
      name: "NAME",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "string",
          internalType: "string"
        }
      ],
      stateMutability: "view"
    }
  ],
  functionName: "NAME"
});
var read5 = async ({
  client,
  contractAddress
}) => await readContract(client, {
  address: contractAddress,
  abi: [
    {
      type: "function",
      name: "VERSION",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "string",
          internalType: "string"
        }
      ],
      stateMutability: "view"
    }
  ],
  functionName: "VERSION"
});
var read6 = async ({
  client,
  contractAddress
}) => await readContract(client, {
  address: contractAddress,
  abi: [
    {
      type: "function",
      name: "DOMAIN_VERSION",
      inputs: [],
      outputs: [
        {
          name: "",
          type: "string",
          internalType: "string"
        }
      ],
      stateMutability: "view"
    }
  ],
  functionName: "DOMAIN_VERSION"
});
var EntryPoint_exports = {};
__export(EntryPoint_exports, {
  read: () => read_exports4
});
var read_exports4 = {};
__export(read_exports4, {
  entryPointGetNonce: () => read7
});
var read7 = async ({
  client,
  entryPoint,
  contractAddress,
  key
}) => await readContract(client, {
  address: entryPoint,
  abi: abi2,
  functionName: "getNonce",
  args: [contractAddress, key]
});
var ERC20TransferAmountEnforcer_exports = {};
__export(ERC20TransferAmountEnforcer_exports, {
  read: () => read_exports5
});
var read_exports5 = {};
__export(read_exports5, {
  getSpentAmount: () => read8,
  getTermsInfo: () => read9
});
var read8 = async ({
  client,
  contractAddress,
  delegationManager,
  delegationHash
}) => {
  const amount = await readContract(client, {
    address: contractAddress,
    abi: abi3,
    functionName: "spentMap",
    args: [delegationManager, delegationHash]
  });
  return amount;
};
var read9 = async ({
  client,
  contractAddress,
  terms
}) => {
  const [allowedContract, maxTokens] = await readContract(client, {
    address: contractAddress,
    abi: abi3,
    functionName: "getTermsInfo",
    args: [terms]
  });
  return {
    allowedContract,
    maxTokens
  };
};
var HybridDeleGator_exports = {};
__export(HybridDeleGator_exports, {
  constants: () => constants_exports2,
  encode: () => encode_exports,
  read: () => read_exports6,
  simulate: () => simulate_exports3
});
var read_exports6 = {};
__export(read_exports6, {
  getKey: () => read10,
  getKeyIdHashes: () => read11,
  getKeyIdHashesCount: () => read12
});
var read10 = async ({
  client,
  hybridDeleGatorAddress,
  keyId
}) => await readContract(client, {
  address: hybridDeleGatorAddress,
  abi: abi4,
  functionName: "getKey",
  args: [keyId]
});
var read11 = async ({
  client,
  hybridDeleGatorAddress
}) => await readContract(client, {
  address: hybridDeleGatorAddress,
  abi: abi4,
  functionName: "getKeyIdHashes"
});
var read12 = async ({
  client,
  hybridDeleGatorAddress
}) => await readContract(client, {
  address: hybridDeleGatorAddress,
  abi: abi4,
  functionName: "getKeyIdHashesCount"
});
var simulate_exports3 = {};
__export(simulate_exports3, {
  addKey: () => simulate2,
  initializeHybridDeleGator: () => simulate,
  reinitializeHybridDeleGator: () => simulate3,
  removeKey: () => simulate4,
  updateSigners: () => simulate5
});
var constants_exports2 = {};
__export(constants_exports2, {
  ANY_BENEFICIARY: () => ANY_BENEFICIARY,
  DOMAIN_VERSION: () => DOMAIN_VERSION2,
  NAME: () => NAME2,
  ROOT_AUTHORITY: () => ROOT_AUTHORITY,
  VERSION: () => VERSION2
});
var NAME2 = "HybridDeleGator";
var VERSION2 = "1.3.0";
var DOMAIN_VERSION2 = "1";
var IdEnforcer_exports = {};
__export(IdEnforcer_exports, {
  read: () => read_exports7
});
var read_exports7 = {};
__export(read_exports7, {
  getIsUsed: () => read13,
  getTermsInfo: () => read14
});
var read13 = async ({
  client,
  contractAddress,
  delegationManager,
  delegator,
  id
}) => {
  const isUsed = await readContract(client, {
    address: contractAddress,
    abi: abi5,
    functionName: "getIsUsed",
    args: [delegationManager, delegator, id]
  });
  return isUsed;
};
var read14 = async ({
  client,
  contractAddress,
  terms
}) => {
  const id = await readContract(client, {
    address: contractAddress,
    abi: abi5,
    functionName: "getTermsInfo",
    args: [terms]
  });
  return id;
};
var LimitedCallsEnforcer_exports = {};
__export(LimitedCallsEnforcer_exports, {
  read: () => read_exports8
});
var read_exports8 = {};
__export(read_exports8, {
  callCounts: () => read15,
  getTermsInfo: () => read16
});
var read15 = async ({
  client,
  contractAddress,
  delegationManager,
  delegationHash
}) => {
  const count = await readContract(client, {
    address: contractAddress,
    abi: abi6,
    functionName: "callCounts",
    args: [delegationManager, delegationHash]
  });
  return count;
};
var read16 = async ({
  client,
  contractAddress,
  terms
}) => {
  const limit = await readContract(client, {
    address: contractAddress,
    abi: abi6,
    functionName: "getTermsInfo",
    args: [terms]
  });
  return limit;
};
var MultiSigDeleGator_exports = {};
__export(MultiSigDeleGator_exports, {
  constants: () => constants_exports3,
  encode: () => encode_exports2,
  read: () => read_exports9,
  simulate: () => simulate_exports4
});
var read_exports9 = {};
__export(read_exports9, {
  getMaxNumberOfSigners: () => read17,
  getSigners: () => read18,
  getSignersCount: () => read19,
  getThreshold: () => read20,
  isSigner: () => read21
});
var read17 = async ({
  client,
  multiSigDeleGatorAddress
}) => await readContract(client, {
  address: multiSigDeleGatorAddress,
  abi: abi7,
  functionName: "MAX_NUMBER_OF_SIGNERS"
});
var read18 = async ({
  client,
  multiSigDeleGatorAddress
}) => await readContract(client, {
  address: multiSigDeleGatorAddress,
  abi: abi7,
  functionName: "getSigners"
});
var read19 = async ({
  client,
  multiSigDeleGatorAddress
}) => await readContract(client, {
  address: multiSigDeleGatorAddress,
  abi: abi7,
  functionName: "getSignersCount"
});
var read20 = async ({
  client,
  multiSigDeleGatorAddress
}) => await readContract(client, {
  address: multiSigDeleGatorAddress,
  abi: abi7,
  functionName: "getThreshold"
});
var read21 = async ({
  client,
  multiSigDeleGatorAddress,
  signer
}) => await readContract(client, {
  address: multiSigDeleGatorAddress,
  abi: abi7,
  functionName: "isSigner",
  args: [signer]
});
var simulate_exports4 = {};
__export(simulate_exports4, {
  addSigner: () => simulate7,
  initializeMultiSigDeleGator: () => simulate6,
  reinitializeMultiSigDeleGator: () => simulate8,
  removeSigner: () => simulate9,
  replaceSigner: () => simulate10,
  updateMultiSigParameters: () => simulate11,
  updateThreshold: () => simulate12
});
var constants_exports3 = {};
__export(constants_exports3, {
  MAX_NUMBER_OF_SIGNERS: () => MAX_NUMBER_OF_SIGNERS
});
var MAX_NUMBER_OF_SIGNERS = 30;
var NativeTokenTransferAmountEnforcer_exports = {};
__export(NativeTokenTransferAmountEnforcer_exports, {
  read: () => read_exports10
});
var read_exports10 = {};
__export(read_exports10, {
  getSpentAmount: () => read22,
  getTermsInfo: () => read23
});
var read22 = async ({
  client,
  contractAddress,
  delegationManager,
  delegationHash
}) => {
  const amount = await readContract(client, {
    address: contractAddress,
    abi: abi8,
    functionName: "spentMap",
    args: [delegationManager, delegationHash]
  });
  return amount;
};
var read23 = async ({
  client,
  contractAddress,
  terms
}) => {
  const allowance = await readContract(client, {
    address: contractAddress,
    abi: abi8,
    functionName: "getTermsInfo",
    args: [terms]
  });
  return allowance;
};
var NonceEnforcer_exports = {};
__export(NonceEnforcer_exports, {
  encode: () => encode_exports6,
  execute: () => execute_exports3,
  read: () => read_exports11,
  simulate: () => simulate_exports5
});
var encode_exports6 = {};
__export(encode_exports6, {
  incrementNonce: () => encode4
});
var encode4 = (delegationManager) => {
  return encodeFunctionData({
    abi: abi9,
    functionName: "incrementNonce",
    args: [delegationManager]
  });
};
var simulate22 = async ({
  client,
  contractAddress,
  delegationManager
}) => {
  return simulateContract(client, {
    address: contractAddress,
    abi: abi9,
    functionName: "incrementNonce",
    args: [delegationManager]
  });
};
var execute10 = async ({
  client,
  contractAddress,
  delegationManager
}) => {
  const { request } = await simulate22({
    client,
    contractAddress,
    delegationManager
  });
  return writeContract(client, request);
};
var execute_exports3 = {};
__export(execute_exports3, {
  incrementNonce: () => execute10
});
var read_exports11 = {};
__export(read_exports11, {
  currentNonce: () => read24,
  getTermsInfo: () => read25
});
var read24 = async ({
  client,
  contractAddress,
  delegationManager,
  delegator
}) => {
  const nonce = await readContract(client, {
    address: contractAddress,
    abi: abi9,
    functionName: "currentNonce",
    args: [delegationManager, delegator]
  });
  return nonce;
};
var read25 = async ({
  client,
  contractAddress,
  terms
}) => {
  const nonce = await readContract(client, {
    address: contractAddress,
    abi: abi9,
    functionName: "getTermsInfo",
    args: [terms]
  });
  return nonce;
};
var simulate_exports5 = {};
__export(simulate_exports5, {
  incrementNonce: () => simulate22
});
var Ownable2Step_exports = {};
__export(Ownable2Step_exports, {
  encode: () => encode_exports7,
  execute: () => execute_exports4,
  read: () => read_exports12,
  simulate: () => simulate_exports6
});
var read_exports12 = {};
__export(read_exports12, {
  getOwner: () => read26,
  getPendingOwner: () => read27
});
var read26 = async ({
  client,
  contractAddress
}) => await readContract(client, {
  address: contractAddress,
  abi: abi10,
  functionName: "owner"
});
var read27 = async ({
  client,
  contractAddress
}) => await readContract(client, {
  address: contractAddress,
  abi: abi10,
  functionName: "pendingOwner"
});
var execute_exports4 = {};
__export(execute_exports4, {
  acceptOwnership: () => execute11,
  renounceOwnership: () => execute12,
  transferOwnership: () => execute13
});
var simulate23 = async ({
  client,
  contractAddress
}) => {
  return simulateContract(client, {
    address: contractAddress,
    abi: abi10,
    functionName: "acceptOwnership"
  });
};
var execute11 = async ({
  client,
  contractAddress
}) => {
  const { request } = await simulate23({
    client,
    contractAddress
  });
  return writeContract(client, request);
};
var encode5 = () => {
  return encodeFunctionData({
    abi: abi10,
    functionName: "acceptOwnership"
  });
};
var simulate24 = async ({
  client,
  contractAddress
}) => {
  return simulateContract(client, {
    address: contractAddress,
    abi: abi10,
    functionName: "renounceOwnership"
  });
};
var execute12 = async ({
  client,
  contractAddress
}) => {
  const { request } = await simulate24({
    client,
    contractAddress
  });
  return writeContract(client, request);
};
var encode6 = () => {
  return encodeFunctionData({
    abi: abi10,
    functionName: "renounceOwnership"
  });
};
var simulate25 = async ({
  client,
  contractAddress,
  account
}) => {
  return simulateContract(client, {
    address: contractAddress,
    abi: abi10,
    functionName: "transferOwnership",
    args: [account]
  });
};
var execute13 = async ({
  client,
  contractAddress,
  account
}) => {
  const { request } = await simulate25({
    client,
    contractAddress,
    account
  });
  return writeContract(client, request);
};
var encode7 = (account) => {
  return encodeFunctionData({
    abi: abi10,
    functionName: "transferOwnership",
    args: [account]
  });
};
var encode_exports7 = {};
__export(encode_exports7, {
  acceptOwnership: () => encode5,
  renounceOwnership: () => encode6,
  transferOwnership: () => encode7
});
var simulate_exports6 = {};
__export(simulate_exports6, {
  acceptOwnership: () => simulate23,
  renounceOwnership: () => simulate24,
  transferOwnership: () => simulate25
});
var Pausable_exports = {};
__export(Pausable_exports, {
  encode: () => encode_exports8,
  execute: () => execute_exports5,
  read: () => read_exports13,
  simulate: () => simulate_exports7
});
var read_exports13 = {};
__export(read_exports13, {
  isPaused: () => read28
});
var read28 = async ({
  client,
  contractAddress
}) => await readContract(client, {
  address: contractAddress,
  abi: abi11,
  functionName: "paused"
});
var execute_exports5 = {};
__export(execute_exports5, {
  pause: () => execute14,
  unpause: () => execute15
});
var PauseAbi = [
  {
    type: "function",
    name: "pause",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable"
  }
];
var simulate26 = async ({
  client,
  contractAddress
}) => {
  return simulateContract(client, {
    address: contractAddress,
    abi: PauseAbi,
    functionName: "pause"
  });
};
var execute14 = async ({
  client,
  contractAddress
}) => {
  const { request } = await simulate26({
    client,
    contractAddress
  });
  return writeContract(client, request);
};
var encode8 = () => {
  return encodeFunctionData({
    abi: PauseAbi,
    functionName: "pause"
  });
};
var UnpauseAbi = [
  {
    type: "function",
    name: "unpause",
    inputs: [],
    outputs: [],
    stateMutability: "nonpayable"
  }
];
var simulate27 = async ({
  client,
  contractAddress
}) => {
  return simulateContract(client, {
    address: contractAddress,
    abi: UnpauseAbi,
    functionName: "unpause"
  });
};
var execute15 = async ({
  client,
  contractAddress
}) => {
  const { request } = await simulate27({
    client,
    contractAddress
  });
  return writeContract(client, request);
};
var encode9 = () => {
  return encodeFunctionData({
    abi: UnpauseAbi,
    functionName: "unpause"
  });
};
var encode_exports8 = {};
__export(encode_exports8, {
  pause: () => encode8,
  unpause: () => encode9
});
var simulate_exports7 = {};
__export(simulate_exports7, {
  pause: () => simulate26,
  unpause: () => simulate27
});
var SimpleFactory_exports = {};
__export(SimpleFactory_exports, {
  encode: () => encode_exports3,
  execute: () => execute_exports6,
  read: () => read_exports14,
  simulate: () => simulate_exports8
});
var execute_exports6 = {};
__export(execute_exports6, {
  create2Deploy: () => execute
});
var read_exports14 = {};
__export(read_exports14, {
  getCreate2Address: () => read29
});
var read29 = async (client, factoryAddress, creationCode, salt) => {
  return readContract(client, {
    address: factoryAddress,
    abi: abi12,
    functionName: "computeAddress",
    args: [creationCode, salt]
  });
};
var simulate_exports8 = {};
__export(simulate_exports8, {
  create2Deploy: () => simulate13
});
var SpecificActionERC20TransferBatchEnforcer_exports = {};
__export(SpecificActionERC20TransferBatchEnforcer_exports, {
  read: () => read_exports15
});
var read_exports15 = {};
__export(read_exports15, {
  getTermsInfo: () => read30,
  usedDelegations: () => read31
});
var read30 = async ({
  client,
  contractAddress,
  terms
}) => {
  const termsData = await readContract(client, {
    address: contractAddress,
    abi: abi13,
    functionName: "getTermsInfo",
    args: [terms]
  });
  return termsData;
};
var read31 = async ({
  client,
  contractAddress,
  delegationManager,
  delegationHash
}) => {
  const isUsed = await readContract(client, {
    address: contractAddress,
    abi: abi13,
    functionName: "usedDelegations",
    args: [delegationManager, delegationHash]
  });
  return isUsed;
};

export {
  DelegationManager_exports
};
