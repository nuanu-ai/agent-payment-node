import { createRequire as __apnSdkCreateRequire, isBuiltin as __apnSdkIsBuiltin } from "node:module"; const __apnSdkRequire = __apnSdkCreateRequire(import.meta.url); const require = (name) => { if (typeof name !== "string" || !__apnSdkIsBuiltin(name)) throw new Error("APN SDK refuses non-builtin dynamic require"); return __apnSdkRequire(name); };
import {
  concat,
  numberToHex,
  pad,
  size
} from "./chunk-S2MT4VX5.mjs";

// node_modules/@metamask/delegation-deployments/dist/index.mjs
var DEPLOYMENTS_1_3_0 = {
  DelegationManager: "0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3",
  EntryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  SimpleFactory: "0x69Aa2f9fe1572F1B640E1bbc512f5c3a734fc77c",
  // Implementations
  MultiSigDeleGatorImpl: "0x56a9EdB16a0105eb5a4C54f4C062e2868844f3A7",
  HybridDeleGatorImpl: "0x48dBe696A4D990079e039489bA2053B36E8FFEC4",
  EIP7702StatelessDeleGatorImpl: "0x63c0c19a282a1B52b07dD5a65b58948A07DAE32B",
  // Caveat Enforcers
  AllowedCalldataEnforcer: "0xc2b0d624c1c4319760C96503BA27C347F3260f55",
  AllowedMethodsEnforcer: "0x2c21fD0Cb9DC8445CB3fb0DC5E7Bb0Aca01842B5",
  AllowedTargetsEnforcer: "0x7F20f61b1f09b08D970938F6fa563634d65c4EeB",
  ApprovalRevocationEnforcer: "0xe264F1f09A19505a1ca1a86D5b01E8bFdb64324A",
  BlockNumberEnforcer: "0x5d9818dF0AE3f66e9c3D0c5029DAF99d1823ca6c",
  DeployedEnforcer: "0x24ff2AA430D53a8CD6788018E902E098083dcCd2",
  ERC20BalanceChangeEnforcer: "0xcdF6aB796408598Cea671d79506d7D48E97a5437",
  ERC20TransferAmountEnforcer: "0xf100b0819427117EcF76Ed94B358B1A5b5C6D2Fc",
  ERC20PeriodTransferEnforcer: "0x474e3Ae7E169e940607cC624Da8A15Eb120139aB",
  ERC20StreamingEnforcer: "0x56c97aE02f233B29fa03502Ecc0457266d9be00e",
  ERC721BalanceChangeEnforcer: "0x8aFdf96eDBbe7e1eD3f5Cd89C7E084841e12A09e",
  ERC721TransferEnforcer: "0x3790e6B7233f779b09DA74C72b6e94813925b9aF",
  ERC1155BalanceChangeEnforcer: "0x63c322732695cAFbbD488Fc6937A0A7B66fC001A",
  ExactCalldataBatchEnforcer: "0x982FD5C86BBF425d7d1451f974192d4525113DfD",
  ExactCalldataEnforcer: "0x99F2e9bF15ce5eC84685604836F71aB835DBBdED",
  ExactExecutionBatchEnforcer: "0x1e141e455d08721Dd5BCDA1BaA6Ea5633Afd5017",
  ExactExecutionEnforcer: "0x146713078D39eCC1F5338309c28405ccf85Abfbb",
  IdEnforcer: "0xC8B5D93463c893401094cc70e66A206fb5987997",
  LogicalOrWrapperEnforcer: "0xE1302607a3251AF54c3a6e69318d6aa07F5eB46c",
  LimitedCallsEnforcer: "0x04658B29F6b82ed55274221a06Fc97D318E25416",
  NativeBalanceChangeEnforcer: "0xbD7B277507723490Cd50b12EaaFe87C616be6880",
  ArgsEqualityCheckEnforcer: "0x44B8C6ae3C304213c3e298495e12497Ed3E56E41",
  NativeTokenPaymentEnforcer: "0x4803a326ddED6dDBc60e659e5ed12d85c7582811",
  NativeTokenTransferAmountEnforcer: "0xF71af580b9c3078fbc2BBF16FbB8EEd82b330320",
  NativeTokenStreamingEnforcer: "0xD10b97905a320b13a0608f7E9cC506b56747df19",
  NativeTokenPeriodTransferEnforcer: "0x9BC0FAf4Aca5AE429F4c06aEEaC517520CB16BD9",
  NonceEnforcer: "0xDE4f2FAC4B3D87A1d9953Ca5FC09FCa7F366254f",
  OwnershipTransferEnforcer: "0x7EEf9734E7092032B5C56310Eb9BbD1f4A524681",
  RedeemerEnforcer: "0xE144b0b2618071B4E56f746313528a669c7E65c5",
  SpecificActionERC20TransferBatchEnforcer: "0x6649b61c873F6F9686A1E1ae9ee98aC380c7bA13",
  TimestampEnforcer: "0x1046bb45C8d673d4ea75321280DB34899413c069",
  ValueLteEnforcer: "0x92Bf12322527cAA612fd31a0e810472BBB106A8F",
  MultiTokenPeriodEnforcer: "0xFB2f1a9BD76d3701B730E5d69C3219D42D80eBb7"
};
var DEPLOYMENTS_1_1_0 = {
  DelegationManager: "0x56D56e07e3d6Ee5a24e30203A37a0a460f42D7A3",
  EntryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  SimpleFactory: "0x6ff518884f21168c30c58CB21184D6AdBC18Ad90",
  // Implementations
  MultiSigDeleGatorImpl: "0xd1f421EDbA5e3FA9efe3874827114b20C5BEC40C",
  HybridDeleGatorImpl: "0x941f3a016F8726d5643Ce62452d0D78492D42b42",
  // Caveat Enforcers
  AllowedCalldataEnforcer: "0xff71d60f3208469cBCE0859717B5198042DCB3F3",
  AllowedMethodsEnforcer: "0xe32C2561792e8446Abe73B9f557B881C13906186",
  AllowedTargetsEnforcer: "0x06aaE4c67EEA95277c46Bf79b1583d4a01772D22",
  BlockNumberEnforcer: "0x8E470D2Ae278457b42d2405E0B8Cd4BE21Ed9045",
  DeployedEnforcer: "0xf9088f013dBD9ebb7Cebd66fEB48253c6Ac5a820",
  ERC20BalanceGteEnforcer: "0xB7B6f32ec6343261D814e55Ed8C5925d91Cab861",
  ERC20TransferAmountEnforcer: "0x9A069b18032B31429A363AeCFb1B6A0564b44471",
  IdEnforcer: "0x91015c3b9D9523966eD2399885e5Df7A567f916c",
  LimitedCallsEnforcer: "0xe694bFfffEA3E85923b1210b37e6a0175e910863",
  NonceEnforcer: "0xE83BCFD8bBE672A96747e831050a91cf44F4F87A",
  TimestampEnforcer: "0x550FdD13eEBC1f22ea2a2480024BacBF0Ad7e5CE",
  ValueLteEnforcer: "0xBE32a6DB7471F63BB168C088c57Db01AfAe87967",
  NativeTokenTransferAmountEnforcer: "0x5eD3833d7B957A8DB8A461c3AF2d668Ec25382E0",
  NativeBalanceGteEnforcer: "0x376a98860E210DdEda3689fb39565592c563cB0A",
  ArgsEqualityCheckEnforcer: "0x7378dE585998d3E18Ce147867C335C25B3dB8Ee5",
  NativeTokenPaymentEnforcer: "0x87Fe18EbF99e42fcE8A03a25F1d20E119407f8e7",
  RedeemerEnforcer: "0x926672b130D1EF60A9d6b11D2048d121b30f40C1"
};
var DEPLOYMENTS_1_0_0 = {
  DelegationManager: "0xbe4138886cb096bdc1b930f2f0ca7892aa234d78",
  EntryPoint: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  SimpleFactory: "0x6ff518884f21168c30c58CB21184D6AdBC18Ad90",
  // Implementations
  MultiSigDeleGatorImpl: "0x11f555af5844d85bfcf5d61d2a22866527eb585a",
  HybridDeleGatorImpl: "0xd6edd1256deccb2b06bdecef92dc16bcf26e531b",
  // Caveat Enforcers
  AllowedCalldataEnforcer: "0x48db3835a873d64a4af2c09f014052407c003bd7",
  AllowedMethodsEnforcer: "0xfd731951bf1c52afccee3e6f14ab656475b76dd4",
  AllowedTargetsEnforcer: "0xbc8673c0afa52d86d991c06881e55b2966920564",
  BlockNumberEnforcer: "0xc15faffa0d879b9263c15a46ce31eacfa2e0e8ae",
  DeployedEnforcer: "0x5accb9559b56a6c1e3f90e342c85c42d93720d43",
  ERC20BalanceGteEnforcer: "0xb5d6b1ec6d868a3bae5b7f48178eaa2686a7a087",
  ERC20TransferAmountEnforcer: "0x92ac423b9c111962179a6242e1adb58d02c103be",
  IdEnforcer: "0x34152d9f3f8f74338d50703e780389e829b4abac",
  LimitedCallsEnforcer: "0x4b3adad4a328bee8ba17b86074d92fe7372180cd",
  NonceEnforcer: "0x2f32ff3fc3086d7f63f16fe8d0065390d460b40d",
  TimestampEnforcer: "0x78e05f779490c24bf3bfa135b4112e7003b321cd",
  ValueLteEnforcer: "0xfc20ede0a1132e839fbda9d7ed3904ff3c89540f"
};
var CHAIN_ID = {
  // Mainnets
  arbitrum: 42161,
  arbitrumNova: 42170,
  base: 8453,
  berachain: 80094,
  bsc: 56,
  gnosis: 100,
  ink: 57073,
  linea: 59144,
  mainnet: 1,
  monad: 143,
  optimism: 10,
  polygon: 137,
  sei: 1329,
  sonic: 146,
  unichain: 130,
  megaEthMainnet: 4326,
  celo: 42220,
  ronin: 2020,
  tempoMainnet: 4217,
  citreaMainnet: 4114,
  mantleMainnet: 5e3,
  katanaMainnet: 747474,
  intuitionMainnet: 1155,
  robinhoodMainnet: 4663,
  // Testnets
  bscTestnet: 97,
  arbitrumSepolia: 421614,
  baseSepolia: 84532,
  berachainBepolia: 80069,
  chiado: 10200,
  citreaTestnet: 5115,
  hoodiTestnet: 560048,
  inkSepolia: 763373,
  lineaSepolia: 59141,
  megaEthTestnet: 6343,
  monadTestnet: 10143,
  optimismSepolia: 11155420,
  polygonAmoy: 80002,
  seiTestnet: 1328,
  sepolia: 11155111,
  sonicTestnet: 14601,
  unichainSepolia: 1301,
  celoSepolia: 11142220,
  roninSaigon: 202601,
  tempoModeratoTestnet: 42431,
  mantleSepolia: 5003,
  katanaBokuto: 737373,
  intuitionTestnet: 13579,
  robinhoodTestnet: 46630,
  arcTestnet: 5042002,
  // decommissioned
  lineaGoerli: 59140
};
var DELEGATOR_CONTRACTS = {
  "1.0.0": {
    // Mainnets
    [CHAIN_ID.optimism]: DEPLOYMENTS_1_0_0,
    [CHAIN_ID.polygon]: DEPLOYMENTS_1_0_0,
    [CHAIN_ID.base]: DEPLOYMENTS_1_0_0,
    [CHAIN_ID.arbitrum]: DEPLOYMENTS_1_0_0,
    [CHAIN_ID.linea]: DEPLOYMENTS_1_0_0,
    // Testnets
    [CHAIN_ID.sepolia]: {
      ...DEPLOYMENTS_1_0_0,
      HybridDeleGatorImpl: "0x5989F5D13DF8fc818EdA65e417AED90459fD67F7"
    },
    [CHAIN_ID.lineaSepolia]: {
      ...DEPLOYMENTS_1_0_0,
      HybridDeleGatorImpl: "0x5989F5D13DF8fc818EdA65e417AED90459fD67F7"
    }
  },
  "1.1.0": {
    // Mainnets
    [CHAIN_ID.arbitrum]: DEPLOYMENTS_1_1_0,
    [CHAIN_ID.base]: DEPLOYMENTS_1_1_0,
    [CHAIN_ID.linea]: DEPLOYMENTS_1_1_0,
    [CHAIN_ID.optimism]: DEPLOYMENTS_1_1_0,
    [CHAIN_ID.polygon]: DEPLOYMENTS_1_1_0,
    // Testnets
    [CHAIN_ID.sepolia]: DEPLOYMENTS_1_1_0,
    [CHAIN_ID.lineaSepolia]: DEPLOYMENTS_1_1_0,
    [CHAIN_ID.baseSepolia]: {
      ...DEPLOYMENTS_1_1_0,
      SimpleFactory: "0xE8eA1DE8D6AfE400B7C8C1A81B7C29B7876b4d02"
    }
  },
  "1.3.0": {
    // Mainnets
    [CHAIN_ID.mainnet]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.polygon]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.bsc]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.optimism]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.arbitrum]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.ink]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.linea]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.base]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.gnosis]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.berachain]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.unichain]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.arbitrumNova]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.sei]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.sonic]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.monad]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.megaEthMainnet]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.celo]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.ronin]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.tempoMainnet]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.citreaMainnet]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.mantleMainnet]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.katanaMainnet]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.intuitionMainnet]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.robinhoodMainnet]: DEPLOYMENTS_1_3_0,
    // Testnets
    [CHAIN_ID.bscTestnet]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.citreaTestnet]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.megaEthTestnet]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.chiado]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.lineaSepolia]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.berachainBepolia]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.baseSepolia]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.arbitrumSepolia]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.sepolia]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.optimismSepolia]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.unichainSepolia]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.polygonAmoy]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.inkSepolia]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.monadTestnet]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.seiTestnet]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.sonicTestnet]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.hoodiTestnet]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.celoSepolia]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.roninSaigon]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.tempoModeratoTestnet]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.mantleSepolia]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.katanaBokuto]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.intuitionTestnet]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.robinhoodTestnet]: DEPLOYMENTS_1_3_0,
    [CHAIN_ID.arcTestnet]: DEPLOYMENTS_1_3_0
  }
};

// node_modules/viem/_esm/account-abstraction/utils/userOperation/getInitCode.js
function getInitCode(userOperation, options = {}) {
  const { forHash } = options;
  const { authorization, factory, factoryData } = userOperation;
  if (forHash && (factory === "0x7702" || factory === "0x7702000000000000000000000000000000000000")) {
    if (!authorization)
      return "0x7702000000000000000000000000000000000000";
    return concat([authorization.address, factoryData ?? "0x"]);
  }
  if (!factory)
    return "0x";
  return concat([factory, factoryData ?? "0x"]);
}

// node_modules/viem/_esm/account-abstraction/utils/userOperation/toPackedUserOperation.js
var paymasterSignatureMagic = "0x22e325a297439656";
function toPackedUserOperation(userOperation, options = {}) {
  const { callGasLimit, callData, maxPriorityFeePerGas, maxFeePerGas, paymaster, paymasterData, paymasterPostOpGasLimit, paymasterSignature, paymasterVerificationGasLimit, sender, signature = "0x", verificationGasLimit } = userOperation;
  const accountGasLimits = concat([
    pad(numberToHex(verificationGasLimit || 0n), { size: 16 }),
    pad(numberToHex(callGasLimit || 0n), { size: 16 })
  ]);
  const initCode = getInitCode(userOperation, options);
  const gasFees = concat([
    pad(numberToHex(maxPriorityFeePerGas || 0n), { size: 16 }),
    pad(numberToHex(maxFeePerGas || 0n), { size: 16 })
  ]);
  const nonce = userOperation.nonce ?? 0n;
  const paymasterAndData = paymaster ? concat([
    paymaster,
    pad(numberToHex(paymasterVerificationGasLimit || 0n), {
      size: 16
    }),
    pad(numberToHex(paymasterPostOpGasLimit || 0n), {
      size: 16
    }),
    paymasterData || "0x",
    ...paymasterSignature ? options.forHash ? [paymasterSignatureMagic] : [
      paymasterSignature,
      pad(numberToHex(size(paymasterSignature)), { size: 2 }),
      paymasterSignatureMagic
    ] : []
  ]) : "0x";
  const preVerificationGas = userOperation.preVerificationGas ?? 0n;
  return {
    accountGasLimits,
    callData,
    initCode,
    gasFees,
    nonce,
    paymasterAndData,
    preVerificationGas,
    sender,
    signature
  };
}

// node_modules/@metamask/smart-accounts-kit/dist/chunk-GMGJRC3D.mjs
var PREFERRED_VERSION = "1.3.0";
var contractOverrideMap = /* @__PURE__ */ new Map();
var getContractOverrideKey = (chainId, version) => `${version}:${chainId}`;
function getSmartAccountsEnvironment(chainId, version = PREFERRED_VERSION) {
  const overrideKey = getContractOverrideKey(chainId, version);
  const overriddenContracts = contractOverrideMap.get(overrideKey);
  if (overriddenContracts) {
    return overriddenContracts;
  }
  const contracts = DELEGATOR_CONTRACTS[version]?.[chainId];
  if (!contracts) {
    throw new Error(
      `No contracts found for version ${version} chain ${chainId}`
    );
  }
  return getSmartAccountsEnvironmentV1(contracts);
}
function getSmartAccountsEnvironmentV1(contracts) {
  return {
    DelegationManager: contracts.DelegationManager,
    EntryPoint: contracts.EntryPoint,
    SimpleFactory: contracts.SimpleFactory,
    implementations: {
      MultiSigDeleGatorImpl: contracts.MultiSigDeleGatorImpl,
      HybridDeleGatorImpl: contracts.HybridDeleGatorImpl,
      EIP7702StatelessDeleGatorImpl: contracts.EIP7702StatelessDeleGatorImpl
    },
    caveatEnforcers: {
      AllowedCalldataEnforcer: contracts.AllowedCalldataEnforcer,
      AllowedMethodsEnforcer: contracts.AllowedMethodsEnforcer,
      AllowedTargetsEnforcer: contracts.AllowedTargetsEnforcer,
      ApprovalRevocationEnforcer: contracts.ApprovalRevocationEnforcer,
      ArgsEqualityCheckEnforcer: contracts.ArgsEqualityCheckEnforcer,
      BlockNumberEnforcer: contracts.BlockNumberEnforcer,
      DeployedEnforcer: contracts.DeployedEnforcer,
      ERC20BalanceChangeEnforcer: contracts.ERC20BalanceChangeEnforcer,
      ERC20TransferAmountEnforcer: contracts.ERC20TransferAmountEnforcer,
      ERC20StreamingEnforcer: contracts.ERC20StreamingEnforcer,
      ERC721BalanceChangeEnforcer: contracts.ERC721BalanceChangeEnforcer,
      ERC721TransferEnforcer: contracts.ERC721TransferEnforcer,
      ERC1155BalanceChangeEnforcer: contracts.ERC1155BalanceChangeEnforcer,
      IdEnforcer: contracts.IdEnforcer,
      LimitedCallsEnforcer: contracts.LimitedCallsEnforcer,
      NonceEnforcer: contracts.NonceEnforcer,
      TimestampEnforcer: contracts.TimestampEnforcer,
      ValueLteEnforcer: contracts.ValueLteEnforcer,
      NativeTokenTransferAmountEnforcer: contracts.NativeTokenTransferAmountEnforcer,
      NativeBalanceChangeEnforcer: contracts.NativeBalanceChangeEnforcer,
      NativeTokenStreamingEnforcer: contracts.NativeTokenStreamingEnforcer,
      NativeTokenPaymentEnforcer: contracts.NativeTokenPaymentEnforcer,
      OwnershipTransferEnforcer: contracts.OwnershipTransferEnforcer,
      RedeemerEnforcer: contracts.RedeemerEnforcer,
      SpecificActionERC20TransferBatchEnforcer: contracts.SpecificActionERC20TransferBatchEnforcer,
      ERC20PeriodTransferEnforcer: contracts.ERC20PeriodTransferEnforcer,
      NativeTokenPeriodTransferEnforcer: contracts.NativeTokenPeriodTransferEnforcer,
      ExactCalldataBatchEnforcer: contracts.ExactCalldataBatchEnforcer,
      ExactCalldataEnforcer: contracts.ExactCalldataEnforcer,
      ExactExecutionEnforcer: contracts.ExactExecutionEnforcer,
      ExactExecutionBatchEnforcer: contracts.ExactExecutionBatchEnforcer,
      MultiTokenPeriodEnforcer: contracts.MultiTokenPeriodEnforcer
    }
  };
}
var SIGNABLE_USER_OP_TYPED_DATA = {
  PackedUserOperation: [
    { name: "sender", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "initCode", type: "bytes" },
    { name: "callData", type: "bytes" },
    { name: "accountGasLimits", type: "bytes32" },
    { name: "preVerificationGas", type: "uint256" },
    { name: "gasFees", type: "bytes32" },
    { name: "paymasterAndData", type: "bytes" },
    { name: "entryPoint", type: "address" }
  ]
};
var prepareSignUserOperationTypedData = ({
  userOperation,
  entryPoint,
  chainId,
  name,
  address,
  version = "1"
}) => {
  const packedUserOp = toPackedUserOperation({
    ...userOperation,
    signature: "0x"
  });
  return {
    domain: {
      chainId,
      name,
      version,
      verifyingContract: address
    },
    types: SIGNABLE_USER_OP_TYPED_DATA,
    primaryType: "PackedUserOperation",
    message: { ...packedUserOp, entryPoint: entryPoint.address }
  };
};

export {
  getSmartAccountsEnvironment,
  prepareSignUserOperationTypedData
};
