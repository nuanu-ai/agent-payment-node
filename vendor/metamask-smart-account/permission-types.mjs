import { createRequire as __apnSdkCreateRequire, isBuiltin as __apnSdkIsBuiltin } from "node:module"; const __apnSdkRequire = __apnSdkCreateRequire(import.meta.url); const require = (name) => { if (typeof name !== "string" || !__apnSdkIsBuiltin(name)) throw new Error("APN SDK refuses non-builtin dynamic require"); return __apnSdkRequire(name); };
import {
  createERC20TokenPeriodTransferTerms,
  createValueLteTerms,
  decodeAllowedCalldataTerms,
  decodeAllowedTargetsTerms,
  decodeApprovalRevocationTerms,
  decodeERC20StreamingTerms,
  decodeERC20TokenPeriodTransferTerms,
  decodeNativeTokenPeriodTransferTerms,
  decodeNativeTokenStreamingTerms,
  decodeRedeemerTerms,
  decodeTimestampTerms
} from "./chunk-GFNUYFFY.mjs";
import {
  bigIntToHex,
  getChecksumAddress,
  hexToBigInt,
  hexToNumber
} from "./chunk-T6VOGCFD.mjs";
import "./chunk-ZSEVIWSW.mjs";
import "./chunk-VBXYOQOU.mjs";
import "./chunk-GQCBBNZL.mjs";

// node_modules/@metamask/7715-permission-types/dist/index.mjs
var ZERO_32_BYTES = "0x0000000000000000000000000000000000000000000000000000000000000000";
var UINT256_MAX = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
var MAX_PERIOD_DURATION = 10 * 365 * 24 * 60 * 60;
function getTermsByEnforcer({
  caveats,
  enforcer,
  throwIfNotFound = true
}) {
  let matchingCaveat;
  for (const caveat of caveats) {
    if (caveat.enforcer !== enforcer) {
      continue;
    }
    if (matchingCaveat) {
      throw new Error(
        `Invalid caveats: multiple caveats found matching enforcer ${enforcer}`
      );
    }
    matchingCaveat = caveat;
  }
  if (!matchingCaveat) {
    if (throwIfNotFound) {
      throw new Error(
        `Invalid caveats: no caveat found matching enforcer ${enforcer}`
      );
    }
    return null;
  }
  return matchingCaveat.terms;
}
var getByteLength = (hexString) => {
  return (hexString.length - 2) / 2;
};
function splitHex(value, lengths) {
  let start = 2;
  const parts = [];
  for (const partLength of lengths) {
    const partCharLength = partLength * 2;
    const part = value.slice(start, start + partCharLength);
    start += partCharLength;
    parts.push(`0x${part}`);
  }
  return parts;
}
var checksumEnforcerAddresses = (contracts) => {
  return {
    erc20StreamingEnforcer: getChecksumAddress(
      contracts.erc20StreamingEnforcer
    ),
    erc20PeriodTransferEnforcer: getChecksumAddress(
      contracts.erc20PeriodTransferEnforcer
    ),
    nativeTokenStreamingEnforcer: getChecksumAddress(
      contracts.nativeTokenStreamingEnforcer
    ),
    nativeTokenPeriodTransferEnforcer: getChecksumAddress(
      contracts.nativeTokenPeriodTransferEnforcer
    ),
    approvalRevocationEnforcer: getChecksumAddress(
      contracts.approvalRevocationEnforcer
    ),
    exactCalldataEnforcer: getChecksumAddress(contracts.exactCalldataEnforcer),
    valueLteEnforcer: getChecksumAddress(contracts.valueLteEnforcer),
    timestampEnforcer: getChecksumAddress(contracts.timestampEnforcer),
    nonceEnforcer: getChecksumAddress(contracts.nonceEnforcer),
    allowedCalldataEnforcer: getChecksumAddress(
      contracts.allowedCalldataEnforcer
    ),
    allowedTargetsEnforcer: getChecksumAddress(
      contracts.allowedTargetsEnforcer
    ),
    redeemerEnforcer: getChecksumAddress(contracts.redeemerEnforcer)
  };
};
var EXECUTION_PERMISSION_EXPIRY_RULE_TYPE = "expiry";
var expiryRuleDecoder = ({
  contractAddresses,
  caveats
}) => {
  const { timestampEnforcer } = contractAddresses;
  const expiryTerms = getTermsByEnforcer({
    caveats,
    enforcer: timestampEnforcer,
    throwIfNotFound: false
  });
  if (!expiryTerms) {
    return null;
  }
  if (expiryTerms.length !== 66) {
    throw new Error("Invalid TimestampEnforcer terms length");
  }
  const decodedTerms = decodeTimestampTerms(expiryTerms);
  const timestampBeforeThreshold = Number(decodedTerms.beforeThreshold);
  const timestampAfterThreshold = Number(decodedTerms.afterThreshold);
  if (timestampBeforeThreshold <= 0) {
    throw new Error(
      "Invalid expiry: timestampBeforeThreshold must be greater than 0"
    );
  }
  if (timestampAfterThreshold !== 0) {
    throw new Error("Invalid expiry: timestampAfterThreshold must be 0");
  }
  return {
    type: EXECUTION_PERMISSION_EXPIRY_RULE_TYPE,
    data: { timestamp: timestampBeforeThreshold }
  };
};
var EXECUTION_PERMISSION_PAYEE_RULE_TYPE = "payee";
var ERC20_TRANSFER_PAYEE_START_INDEX = 4;
var ERC20_PAYEE_VALUE_BYTE_LENGTH = 32;
var erc20PayeeRuleDecoder = ({
  contractAddresses,
  caveats,
  requiredEnforcers
}) => {
  const { allowedCalldataEnforcer } = contractAddresses;
  if (requiredEnforcers.has(allowedCalldataEnforcer)) {
    throw new Error(
      "Invalid payee caveats: payee enforcer may not be a required caveat"
    );
  }
  const terms = getTermsByEnforcer({
    caveats,
    enforcer: allowedCalldataEnforcer,
    throwIfNotFound: false
  });
  if (!terms) {
    return null;
  }
  const decoded = decodeAllowedCalldataTerms(terms);
  if (decoded.startIndex !== ERC20_TRANSFER_PAYEE_START_INDEX) {
    throw new Error(
      `Invalid payee caveat: AllowedCalldataEnforcer startIndex must be ${ERC20_TRANSFER_PAYEE_START_INDEX}`
    );
  }
  if (getByteLength(decoded.value) !== ERC20_PAYEE_VALUE_BYTE_LENGTH) {
    throw new Error(
      `Invalid payee caveat: AllowedCalldataEnforcer value must be ${ERC20_PAYEE_VALUE_BYTE_LENGTH} bytes long`
    );
  }
  const address = `0x${decoded.value.slice(-40)}`;
  return {
    type: EXECUTION_PERMISSION_PAYEE_RULE_TYPE,
    data: { addresses: [getChecksumAddress(address)] }
  };
};
var nativePayeeRuleDecoder = ({
  contractAddresses,
  caveats,
  requiredEnforcers
}) => {
  const { allowedTargetsEnforcer } = contractAddresses;
  if (requiredEnforcers.has(allowedTargetsEnforcer)) {
    throw new Error(
      "Invalid payee caveats: payee enforcer may not be a required caveat"
    );
  }
  const terms = getTermsByEnforcer({
    caveats,
    enforcer: allowedTargetsEnforcer,
    throwIfNotFound: false
  });
  if (!terms) {
    return null;
  }
  const decoded = decodeAllowedTargetsTerms(terms);
  return {
    type: EXECUTION_PERMISSION_PAYEE_RULE_TYPE,
    data: { addresses: decoded.targets.map(getChecksumAddress) }
  };
};
var EXECUTION_PERMISSION_REDEEMER_RULE_TYPE = "redeemer";
var redeemerRuleDecoder = ({
  contractAddresses,
  caveats
}) => {
  const { redeemerEnforcer } = contractAddresses;
  const terms = getTermsByEnforcer({
    caveats,
    enforcer: redeemerEnforcer,
    throwIfNotFound: false
  });
  if (!terms) {
    return null;
  }
  const { redeemers } = decodeRedeemerTerms(terms);
  const addresses = redeemers.map(getChecksumAddress);
  return {
    type: EXECUTION_PERMISSION_REDEEMER_RULE_TYPE,
    data: {
      addresses
    }
  };
};
function makeErc20TokenAllowanceDecoderConfig(contractAddresses) {
  const {
    timestampEnforcer,
    erc20PeriodTransferEnforcer,
    valueLteEnforcer,
    nonceEnforcer,
    allowedCalldataEnforcer,
    redeemerEnforcer
  } = contractAddresses;
  return {
    permissionType: "erc20-token-allowance",
    contractAddresses,
    optionalEnforcers: [
      timestampEnforcer,
      // expiry rule
      redeemerEnforcer,
      // redeemer rule
      allowedCalldataEnforcer
      // payee rule
    ],
    requiredEnforcers: {
      [erc20PeriodTransferEnforcer]: 1,
      [valueLteEnforcer]: 1,
      [nonceEnforcer]: 1
    },
    rules: [expiryRuleDecoder, redeemerRuleDecoder, erc20PayeeRuleDecoder],
    validateAndDecodeData
  };
}
function validateAndDecodeData(caveats, contractAddresses) {
  const { erc20PeriodTransferEnforcer, valueLteEnforcer } = contractAddresses;
  const valueLteTerms = getTermsByEnforcer({
    caveats,
    enforcer: valueLteEnforcer
  });
  if (valueLteTerms !== ZERO_32_BYTES) {
    throw new Error(`Invalid value-lte terms: must be ${ZERO_32_BYTES}`);
  }
  const terms = getTermsByEnforcer({
    caveats,
    enforcer: erc20PeriodTransferEnforcer
  });
  const EXPECTED_TERMS_BYTELENGTH = 116;
  if (getByteLength(terms) !== EXPECTED_TERMS_BYTELENGTH) {
    throw new Error("Invalid erc20-token-allowance terms: expected 116 bytes");
  }
  const [tokenAddress, allowanceAmount, periodDurationRaw, startTimeRaw] = splitHex(terms, [20, 32, 32, 32]);
  if (periodDurationRaw.toLowerCase() !== UINT256_MAX) {
    throw new Error(
      "Invalid erc20-token-allowance terms: periodDuration must be UINT256_MAX"
    );
  }
  const startTime = hexToNumber(startTimeRaw);
  if (startTime === 0) {
    throw new Error(
      "Invalid erc20-token-allowance terms: startTime must be a positive number"
    );
  }
  if (allowanceAmount === ZERO_32_BYTES) {
    throw new Error(
      "Invalid erc20-token-allowance terms: allowanceAmount must be a positive number"
    );
  }
  return { tokenAddress, allowanceAmount, startTime };
}
function createErc20TokenAllowanceCaveats({
  permission,
  contracts
}) {
  const { tokenAddress, allowanceAmount, startTime } = permission.data;
  const allowanceAmountBigInt = hexToBigInt(allowanceAmount);
  if (allowanceAmountBigInt === 0n) {
    throw new Error(
      "Invalid erc20-token-allowance permission: allowanceAmount must be a positive number."
    );
  }
  if (startTime <= 0) {
    throw new Error(
      "Invalid erc20-token-allowance permission: startTime must be a positive number."
    );
  }
  const erc20PeriodCaveat = {
    enforcer: contracts.erc20PeriodTransferEnforcer,
    terms: createERC20TokenPeriodTransferTerms({
      tokenAddress,
      periodAmount: allowanceAmountBigInt,
      // delegation-core accepts bigint for encoding although the type is `number`.
      periodDuration: BigInt(UINT256_MAX),
      startDate: startTime
    }),
    args: "0x"
  };
  const valueLteCaveat = {
    enforcer: contracts.valueLteEnforcer,
    terms: createValueLteTerms({ maxValue: 0n }),
    args: "0x"
  };
  return [erc20PeriodCaveat, valueLteCaveat];
}
function makeErc20TokenPeriodicDecoderConfig(contractAddresses) {
  const {
    timestampEnforcer,
    erc20PeriodTransferEnforcer,
    valueLteEnforcer,
    nonceEnforcer,
    allowedCalldataEnforcer,
    redeemerEnforcer
  } = contractAddresses;
  return {
    permissionType: "erc20-token-periodic",
    contractAddresses,
    optionalEnforcers: [
      timestampEnforcer,
      // expiry rule
      redeemerEnforcer,
      // redeemer rule
      allowedCalldataEnforcer
      // payee rule
    ],
    requiredEnforcers: {
      [erc20PeriodTransferEnforcer]: 1,
      [valueLteEnforcer]: 1,
      [nonceEnforcer]: 1
    },
    rules: [expiryRuleDecoder, redeemerRuleDecoder, erc20PayeeRuleDecoder],
    validateAndDecodeData: validateAndDecodeData2
  };
}
function validateAndDecodeData2(caveats, contractAddresses) {
  const { erc20PeriodTransferEnforcer, valueLteEnforcer } = contractAddresses;
  const valueLteTerms = getTermsByEnforcer({
    caveats,
    enforcer: valueLteEnforcer
  });
  if (valueLteTerms !== ZERO_32_BYTES) {
    throw new Error(`Invalid value-lte terms: must be ${ZERO_32_BYTES}`);
  }
  const terms = getTermsByEnforcer({
    caveats,
    enforcer: erc20PeriodTransferEnforcer
  });
  const {
    tokenAddress,
    periodAmount,
    periodDuration,
    startDate: startTime
  } = decodeERC20TokenPeriodTransferTerms(terms);
  if (periodAmount === 0n) {
    throw new Error(
      "Invalid erc20-token-periodic terms: periodAmount must be a positive number"
    );
  }
  if (periodDuration === 0) {
    throw new Error(
      "Invalid erc20-token-periodic terms: periodDuration must be a positive number"
    );
  }
  if (periodDuration > MAX_PERIOD_DURATION) {
    throw new Error(
      "Invalid erc20-token-periodic terms: periodDuration must be less than or equal to MAX_PERIOD_DURATION"
    );
  }
  if (startTime === 0) {
    throw new Error(
      "Invalid erc20-token-periodic terms: startTime must be a positive number"
    );
  }
  return {
    tokenAddress,
    periodAmount: bigIntToHex(periodAmount),
    periodDuration,
    startTime
  };
}
function makeErc20TokenStreamDecoderConfig(contractAddresses) {
  const {
    timestampEnforcer,
    erc20StreamingEnforcer,
    valueLteEnforcer,
    nonceEnforcer,
    allowedCalldataEnforcer,
    redeemerEnforcer
  } = contractAddresses;
  return {
    permissionType: "erc20-token-stream",
    contractAddresses,
    optionalEnforcers: [
      timestampEnforcer,
      // expiry rule
      redeemerEnforcer,
      // redeemer rule
      allowedCalldataEnforcer
      // payee rule
    ],
    requiredEnforcers: {
      [erc20StreamingEnforcer]: 1,
      [valueLteEnforcer]: 1,
      [nonceEnforcer]: 1
    },
    rules: [expiryRuleDecoder, redeemerRuleDecoder, erc20PayeeRuleDecoder],
    validateAndDecodeData: validateAndDecodeData3
  };
}
function validateAndDecodeData3(caveats, contractAddresses) {
  const { erc20StreamingEnforcer, valueLteEnforcer } = contractAddresses;
  const valueLteTerms = getTermsByEnforcer({
    caveats,
    enforcer: valueLteEnforcer
  });
  if (valueLteTerms !== ZERO_32_BYTES) {
    throw new Error(`Invalid value-lte terms: must be ${ZERO_32_BYTES}`);
  }
  const terms = getTermsByEnforcer({
    caveats,
    enforcer: erc20StreamingEnforcer
  });
  const { tokenAddress, initialAmount, maxAmount, amountPerSecond, startTime } = decodeERC20StreamingTerms(terms);
  if (maxAmount <= initialAmount) {
    throw new Error(
      "Invalid erc20-token-stream terms: maxAmount must be greater than initialAmount"
    );
  }
  if (amountPerSecond === 0n) {
    throw new Error(
      "Invalid erc20-token-stream terms: amountPerSecond must be a positive number"
    );
  }
  if (startTime === 0) {
    throw new Error(
      "Invalid erc20-token-stream terms: startTime must be a positive number"
    );
  }
  return {
    tokenAddress,
    initialAmount: bigIntToHex(initialAmount),
    maxAmount: bigIntToHex(maxAmount),
    amountPerSecond: bigIntToHex(amountPerSecond),
    startTime
  };
}
function makeNativeTokenAllowanceDecoderConfig(contractAddresses) {
  const {
    timestampEnforcer,
    nativeTokenPeriodTransferEnforcer,
    exactCalldataEnforcer,
    nonceEnforcer,
    allowedTargetsEnforcer,
    redeemerEnforcer
  } = contractAddresses;
  return {
    permissionType: "native-token-allowance",
    contractAddresses,
    optionalEnforcers: [
      timestampEnforcer,
      // expiry rule
      redeemerEnforcer,
      // redeemer rule
      allowedTargetsEnforcer
      // payee rule
    ],
    requiredEnforcers: {
      [nativeTokenPeriodTransferEnforcer]: 1,
      [exactCalldataEnforcer]: 1,
      [nonceEnforcer]: 1
    },
    rules: [expiryRuleDecoder, redeemerRuleDecoder, nativePayeeRuleDecoder],
    validateAndDecodeData: validateAndDecodeData4
  };
}
function validateAndDecodeData4(caveats, contractAddresses) {
  const { nativeTokenPeriodTransferEnforcer, exactCalldataEnforcer } = contractAddresses;
  const exactCalldataTerms = getTermsByEnforcer({
    caveats,
    enforcer: exactCalldataEnforcer
  });
  if (exactCalldataTerms !== "0x") {
    throw new Error("Invalid exact-calldata terms: must be 0x");
  }
  const terms = getTermsByEnforcer({
    caveats,
    enforcer: nativeTokenPeriodTransferEnforcer
  });
  const EXPECTED_TERMS_BYTELENGTH = 96;
  if (getByteLength(terms) !== EXPECTED_TERMS_BYTELENGTH) {
    throw new Error("Invalid native-token-allowance terms: expected 96 bytes");
  }
  const [allowanceAmount, periodDurationRaw, startTimeRaw] = splitHex(
    terms,
    [32, 32, 32]
  );
  if (periodDurationRaw.toLowerCase() !== UINT256_MAX) {
    throw new Error(
      "Invalid native-token-allowance terms: periodDuration must be UINT256_MAX"
    );
  }
  const startTime = hexToNumber(startTimeRaw);
  if (startTime === 0) {
    throw new Error(
      "Invalid native-token-allowance terms: startTime must be a positive number"
    );
  }
  if (allowanceAmount === ZERO_32_BYTES) {
    throw new Error(
      "Invalid native-token-allowance terms: allowanceAmount must be a positive number"
    );
  }
  return { allowanceAmount, startTime };
}
function makeNativeTokenPeriodicDecoderConfig(contractAddresses) {
  const {
    timestampEnforcer,
    nativeTokenPeriodTransferEnforcer,
    exactCalldataEnforcer,
    nonceEnforcer,
    allowedTargetsEnforcer,
    redeemerEnforcer
  } = contractAddresses;
  return {
    permissionType: "native-token-periodic",
    contractAddresses,
    optionalEnforcers: [
      timestampEnforcer,
      // expiry rule
      redeemerEnforcer,
      // redeemer rule
      allowedTargetsEnforcer
      // payee rule
    ],
    requiredEnforcers: {
      [nativeTokenPeriodTransferEnforcer]: 1,
      [exactCalldataEnforcer]: 1,
      [nonceEnforcer]: 1
    },
    rules: [expiryRuleDecoder, redeemerRuleDecoder, nativePayeeRuleDecoder],
    validateAndDecodeData: validateAndDecodeData5
  };
}
function validateAndDecodeData5(caveats, contractAddresses) {
  const { nativeTokenPeriodTransferEnforcer, exactCalldataEnforcer } = contractAddresses;
  const exactCalldataTerms = getTermsByEnforcer({
    caveats,
    enforcer: exactCalldataEnforcer
  });
  if (exactCalldataTerms !== "0x") {
    throw new Error("Invalid exact-calldata terms: must be 0x");
  }
  const terms = getTermsByEnforcer({
    caveats,
    enforcer: nativeTokenPeriodTransferEnforcer
  });
  const {
    periodAmount,
    periodDuration,
    startDate: startTime
  } = decodeNativeTokenPeriodTransferTerms(terms);
  if (periodAmount === 0n) {
    throw new Error(
      "Invalid native-token-periodic terms: periodAmount must be a positive number"
    );
  }
  if (periodDuration === 0) {
    throw new Error(
      "Invalid native-token-periodic terms: periodDuration must be a positive number"
    );
  }
  if (periodDuration > MAX_PERIOD_DURATION) {
    throw new Error(
      "Invalid native-token-periodic terms: periodDuration must be less than or equal to MAX_PERIOD_DURATION"
    );
  }
  if (startTime === 0) {
    throw new Error(
      "Invalid native-token-periodic terms: startTime must be a positive number"
    );
  }
  return {
    periodAmount: bigIntToHex(periodAmount),
    periodDuration,
    startTime
  };
}
function makeNativeTokenStreamDecoderConfig(contractAddresses) {
  const {
    timestampEnforcer,
    nativeTokenStreamingEnforcer,
    exactCalldataEnforcer,
    nonceEnforcer,
    allowedTargetsEnforcer,
    redeemerEnforcer
  } = contractAddresses;
  return {
    permissionType: "native-token-stream",
    contractAddresses,
    optionalEnforcers: [
      timestampEnforcer,
      // expiry rule
      redeemerEnforcer,
      // redeemer rule
      allowedTargetsEnforcer
      // payee rule
    ],
    requiredEnforcers: {
      [nativeTokenStreamingEnforcer]: 1,
      [exactCalldataEnforcer]: 1,
      [nonceEnforcer]: 1
    },
    rules: [expiryRuleDecoder, redeemerRuleDecoder, nativePayeeRuleDecoder],
    validateAndDecodeData: validateAndDecodeData6
  };
}
function validateAndDecodeData6(caveats, contractAddresses) {
  const { nativeTokenStreamingEnforcer, exactCalldataEnforcer } = contractAddresses;
  const exactCalldataTerms = getTermsByEnforcer({
    caveats,
    enforcer: exactCalldataEnforcer
  });
  if (exactCalldataTerms !== "0x") {
    throw new Error("Invalid exact-calldata terms: must be 0x");
  }
  const terms = getTermsByEnforcer({
    caveats,
    enforcer: nativeTokenStreamingEnforcer
  });
  const { initialAmount, maxAmount, amountPerSecond, startTime } = decodeNativeTokenStreamingTerms(terms);
  if (maxAmount <= initialAmount) {
    throw new Error(
      "Invalid native-token-stream terms: maxAmount must be greater than initialAmount"
    );
  }
  if (amountPerSecond === 0n) {
    throw new Error(
      "Invalid native-token-stream terms: amountPerSecond must be a positive number"
    );
  }
  if (startTime === 0) {
    throw new Error(
      "Invalid native-token-stream terms: startTime must be a positive number"
    );
  }
  return {
    initialAmount: bigIntToHex(initialAmount),
    maxAmount: bigIntToHex(maxAmount),
    amountPerSecond: bigIntToHex(amountPerSecond),
    startTime
  };
}
function makeTokenApprovalRevocationDecoderConfig(contractAddresses) {
  const { timestampEnforcer, approvalRevocationEnforcer, nonceEnforcer } = contractAddresses;
  return {
    permissionType: "token-approval-revocation",
    contractAddresses,
    optionalEnforcers: [
      timestampEnforcer
      // expiry rule
    ],
    requiredEnforcers: {
      [approvalRevocationEnforcer]: 1,
      [nonceEnforcer]: 1
    },
    rules: [expiryRuleDecoder],
    validateAndDecodeData: validateAndDecodeData7
  };
}
function validateAndDecodeData7(caveats, contractAddresses) {
  const { approvalRevocationEnforcer } = contractAddresses;
  const terms = getTermsByEnforcer({
    caveats,
    enforcer: approvalRevocationEnforcer
  });
  const {
    erc20Approve,
    erc721Approve,
    erc721SetApprovalForAll,
    permit2Approve,
    permit2Lockdown,
    permit2InvalidateNonces
  } = decodeApprovalRevocationTerms(terms);
  return {
    erc20Approve,
    erc721Approve,
    erc721SetApprovalForAll,
    permit2Approve,
    permit2Lockdown,
    permit2InvalidateNonces
  };
}
var SECOND = 1e3;
var HOUR = 60 * 60 * SECOND;
var DAY = 24 * HOUR;
var WEEK = 7 * DAY;
var FORTNIGHT = 2 * WEEK;
var MONTH = 30 * DAY;
var YEAR = 365 * DAY;
var MAX_UINT256 = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
var METAMASK_FACILITATOR_ADDRESSES = [
  "0xB01caEa8c6C47bbf4F4b4c5080Ca642043359C2E",
  "0xC066ac5D385419B1A8c43A0E146fA439837a8B8c",
  "0xB42F812A44c22cc6b861478900401ee759EbEAD6"
];
var METAMASK_FACILITATOR_ADDRESSES_DEV = [
  "0xb4827A2a066CD2Ef88560EFdf063dD05C6c41cC7"
];
var ALL_METAMASK_FACILITATOR_ADDRESSES = [
  ...METAMASK_FACILITATOR_ADDRESSES,
  ...METAMASK_FACILITATOR_ADDRESSES_DEV
];
var METAMASK_FACILITATOR_ADDRESSES_LOWERCASE = new Set(
  ALL_METAMASK_FACILITATOR_ADDRESSES.map((address) => address.toLowerCase())
);
function isMetaMaskFacilitatorAddress(address) {
  return METAMASK_FACILITATOR_ADDRESSES_LOWERCASE.has(address.toLowerCase());
}
function areOnlyMetaMaskFacilitatorAddresses(addresses) {
  if (!addresses?.length) {
    return false;
  }
  return addresses.every(isMetaMaskFacilitatorAddress);
}
function parseHexPermissionAmount(value) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("Cannot parse empty permission amount");
  }
  return hexToBigInt(trimmed);
}
function getPeriodFrequencyValueTranslationKey(periodDurationInSeconds) {
  const periodDurationMillisecond = periodDurationInSeconds * SECOND;
  if (periodDurationMillisecond === DAY) {
    return "gatorPermissionDailyFrequency";
  } else if (periodDurationMillisecond === WEEK) {
    return "gatorPermissionWeeklyFrequency";
  } else if (periodDurationMillisecond === FORTNIGHT) {
    return "gatorPermissionFortnightlyFrequency";
  } else if (periodDurationMillisecond === MONTH) {
    return "gatorPermissionMonthlyFrequency";
  } else if (periodDurationMillisecond === YEAR) {
    return "gatorPermissionAnnualFrequency";
  }
  return "gatorPermissionCustomFrequency";
}
function formatPermissionPeriodDuration(periodSeconds) {
  if (periodSeconds === 0) {
    throw new Error("Cannot format period duration of 0 seconds");
  }
  if (periodSeconds < 0) {
    throw new Error("Cannot format negative period duration");
  }
  const periodMilliseconds = periodSeconds * SECOND;
  switch (periodMilliseconds) {
    case HOUR:
      return { key: "confirmFieldPeriodDurationHourly" };
    case DAY:
      return { key: "confirmFieldPeriodDurationDaily" };
    case WEEK:
      return { key: "confirmFieldPeriodDurationWeekly" };
    case FORTNIGHT:
      return { key: "confirmFieldPeriodDurationBiWeekly" };
    case MONTH:
      return { key: "confirmFieldPeriodDurationMonthly" };
    case YEAR:
      return { key: "confirmFieldPeriodDurationYearly" };
    default:
      return {
        key: "confirmFieldPeriodDurationSeconds",
        args: [periodSeconds]
      };
  }
}
function convertMillisecondsToSeconds(milliseconds) {
  return milliseconds / SECOND;
}
function convertAmountPerSecondToAmountPerPeriod(amountPerSecond, period) {
  const amountBigInt = hexToBigInt(amountPerSecond);
  switch (period) {
    case "weekly":
      return bigIntToHex(
        amountBigInt * BigInt(convertMillisecondsToSeconds(WEEK))
      );
    case "monthly":
      return bigIntToHex(
        amountBigInt * BigInt(convertMillisecondsToSeconds(MONTH))
      );
    case "fortnightly":
      return bigIntToHex(
        amountBigInt * BigInt(convertMillisecondsToSeconds(FORTNIGHT))
      );
    case "yearly":
      return bigIntToHex(
        amountBigInt * BigInt(convertMillisecondsToSeconds(YEAR))
      );
    default:
      throw new Error(`Invalid period: ${period}`);
  }
}
var getData = (ctx, key) => ctx.permission.data[key];
function getStreamTotalExposure(ctx) {
  if (ctx.streamTotalExposure === void 0) {
    throw new Error(
      "PermissionRenderContext.streamTotalExposure must be set when rendering stream permission fields"
    );
  }
  return ctx.streamTotalExposure;
}
var requireStartTime = (permission) => {
  if (!permission.data.startTime) {
    throw new Error("Start time is required");
  }
};
var alwaysVisible = () => true;
var getJustificationValue = (ctx) => {
  if (ctx.permission.justification) {
    return ctx.permission.justification;
  }
  return { key: "gatorNoJustificationProvided" };
};
var justificationSection = {
  testId: "confirmation_justification-section",
  elements: [
    {
      type: "justification",
      labelKey: "gatorPermissionsJustification",
      testId: "review-gator-permission-justification",
      getValue: getJustificationValue,
      isVisible: alwaysVisible,
      includeInViews: ["confirmation", "reviewDetail"]
    },
    {
      type: "account",
      labelKey: "account",
      testId: "review-gator-permission-account-name",
      getValue: () => void 0,
      isVisible: alwaysVisible,
      includeInViews: ["confirmation"]
    }
  ]
};
var reviewSummaryAccountSection = {
  testId: "review_summary-account-section",
  elements: [
    {
      type: "account",
      labelKey: "account",
      testId: "review-gator-permission-account-name",
      getValue: () => void 0,
      isVisible: alwaysVisible,
      includeInViews: ["reviewSummary"]
    }
  ]
};
var permissionInfoSection = {
  testId: "confirmation_permission-section",
  elements: [
    {
      type: "origin",
      labelKey: "requestFrom",
      testId: "confirmation-origin",
      getValue: (ctx) => ctx.origin,
      isVisible: alwaysVisible,
      includeInViews: ["confirmation"]
    },
    {
      type: "address",
      labelKey: "recipient",
      testId: "confirmation-recipient",
      getValue: (ctx) => ctx.to,
      isVisible: (ctx) => Boolean(ctx.to),
      includeInViews: ["confirmation"]
    },
    { type: "network", includeInViews: ["confirmation", "reviewDetail"] },
    {
      type: "text",
      labelKey: "redeemers",
      testId: "confirmation-redeemer-metamask-facilitator",
      getValue: () => ({ key: "gatorPermissionsMetaMaskFacilitator" }),
      isVisible: (ctx) => areOnlyMetaMaskFacilitatorAddresses(ctx.redeemerAddresses),
      includeInViews: ["confirmation", "reviewDetail"]
    },
    {
      type: "rule-address",
      labelKey: "redeemer",
      testId: "confirmation-redeemer",
      getValue: (ctx) => ctx.redeemerAddresses ?? void 0,
      isVisible: (ctx) => Boolean(ctx.redeemerAddresses?.length) && !areOnlyMetaMaskFacilitatorAddresses(ctx.redeemerAddresses),
      includeInViews: ["confirmation", "reviewDetail"]
    },
    {
      type: "rule-address",
      labelKey: "payee",
      testId: "confirmation-payee",
      getValue: (ctx) => ctx.payeeAddresses ?? void 0,
      isVisible: (ctx) => Boolean(ctx.payeeAddresses?.length),
      includeInViews: ["confirmation", "reviewDetail"]
    }
  ]
};
var periodicDetailsSection = (testId, tokenAddressKey) => ({
  testId,
  elements: [
    {
      type: "amount",
      labelKey: "amount",
      testId: "review-gator-permission-amount-label",
      getValue: (ctx) => parseHexPermissionAmount(getData(ctx, "periodAmount")),
      isVisible: alwaysVisible,
      includeInViews: ["reviewSummary"]
    },
    {
      type: "text",
      labelKey: "gatorPermissionTokenPeriodicFrequencyLabel",
      testId: "review-gator-permission-frequency-label",
      getValue: (ctx) => ({
        key: getPeriodFrequencyValueTranslationKey(
          getData(ctx, "periodDuration")
        )
      }),
      isVisible: alwaysVisible,
      includeInViews: ["reviewSummary"]
    },
    {
      type: "amount",
      labelKey: "confirmFieldAllowance",
      testId: "confirmation-allowance",
      getValue: (ctx) => parseHexPermissionAmount(getData(ctx, "periodAmount")),
      getTokenAddress: tokenAddressKey ? (ctx) => getData(ctx, tokenAddressKey) : void 0,
      isVisible: alwaysVisible,
      includeInViews: ["confirmation"]
    },
    {
      type: "text",
      labelKey: "confirmFieldFrequency",
      testId: "confirmation-frequency",
      getValue: (ctx) => formatPermissionPeriodDuration(getData(ctx, "periodDuration")),
      isVisible: alwaysVisible,
      includeInViews: ["confirmation"]
    },
    { type: "divider", includeInViews: ["confirmation"] },
    {
      type: "date",
      labelKey: "gatorPermissionsStartDate",
      testId: "review-gator-permission-start-date",
      getValue: (ctx) => getData(ctx, "startTime"),
      isVisible: alwaysVisible,
      includeInViews: ["confirmation", "reviewDetail"]
    },
    {
      type: "expiry",
      labelKey: "gatorPermissionsExpirationDate",
      testId: "review-gator-permission-expiration-date",
      getValue: (ctx) => ctx.expiry,
      isVisible: alwaysVisible,
      includeInViews: ["confirmation", "reviewDetail"]
    }
  ]
});
var streamDetailsSection = (testId, tokenAddressKey) => ({
  testId,
  elements: [
    {
      type: "amount",
      labelKey: "gatorPermissionsStreamingAmountLabel",
      testId: "review-gator-permission-amount-label",
      getValue: (ctx) => parseHexPermissionAmount(
        convertAmountPerSecondToAmountPerPeriod(
          getData(ctx, "amountPerSecond"),
          "weekly"
        )
      ),
      isVisible: alwaysVisible,
      includeInViews: ["reviewSummary"]
    },
    {
      type: "text",
      labelKey: "gatorPermissionTokenStreamFrequencyLabel",
      testId: "review-gator-permission-frequency-label",
      getValue: () => ({ key: "gatorPermissionWeeklyFrequency" }),
      isVisible: alwaysVisible,
      includeInViews: ["reviewSummary"]
    },
    {
      type: "amount",
      labelKey: "gatorPermissionsInitialAllowance",
      testId: "review-gator-permission-initial-allowance",
      getValue: (ctx) => parseHexPermissionAmount(getData(ctx, "initialAmount")),
      getTokenAddress: tokenAddressKey ? (ctx) => getData(ctx, tokenAddressKey) : void 0,
      isVisible: (ctx) => Boolean(getData(ctx, "initialAmount")),
      includeInViews: ["confirmation", "reviewDetail"]
    },
    {
      type: "amount",
      labelKey: "gatorPermissionsMaxAllowance",
      testId: "review-gator-permission-max-allowance",
      getValue: (ctx) => parseHexPermissionAmount(getData(ctx, "maxAmount")),
      getTokenAddress: tokenAddressKey ? (ctx) => getData(ctx, tokenAddressKey) : void 0,
      isVisible: (ctx) => {
        const max = getData(ctx, "maxAmount");
        return max !== void 0 && max !== null && max.toLowerCase() !== MAX_UINT256;
      },
      includeInViews: ["confirmation", "reviewDetail"]
    },
    {
      type: "text",
      labelKey: "gatorPermissionsMaxAllowance",
      testId: "review-gator-permission-max-allowance-unlimited",
      getValue: () => ({ key: "unlimited" }),
      isVisible: (ctx) => {
        const max = getData(ctx, "maxAmount");
        return Boolean(max?.toLowerCase() === MAX_UINT256);
      },
      includeInViews: ["confirmation", "reviewDetail"]
    },
    { type: "divider", includeInViews: ["confirmation"] },
    {
      type: "date",
      labelKey: "gatorPermissionsStartDate",
      testId: "review-gator-permission-start-date",
      getValue: (ctx) => getData(ctx, "startTime"),
      isVisible: alwaysVisible,
      includeInViews: ["confirmation", "reviewDetail"]
    },
    {
      type: "expiry",
      labelKey: "gatorPermissionsExpirationDate",
      testId: "review-gator-permission-expiration-date",
      getValue: (ctx) => ctx.expiry,
      isVisible: alwaysVisible,
      includeInViews: ["confirmation", "reviewDetail"]
    }
  ]
});
var streamRateSection = (testId, tokenAddressKey) => ({
  testId,
  elements: [
    {
      type: "amount",
      labelKey: "gatorPermissionsStreamRate",
      testId: "review-gator-permission-stream-rate",
      getValue: (ctx) => parseHexPermissionAmount(getData(ctx, "amountPerSecond")),
      getTokenAddress: tokenAddressKey ? (ctx) => getData(ctx, tokenAddressKey) : void 0,
      isRatePerSecond: true,
      isVisible: alwaysVisible,
      includeInViews: ["confirmation", "reviewDetail"]
    },
    {
      type: "amount",
      labelKey: "confirmFieldAvailablePerDay",
      testId: "confirmation-available-per-day",
      getValue: (ctx) => parseHexPermissionAmount(getData(ctx, "amountPerSecond")) * BigInt(DAY / 1e3),
      getTokenAddress: tokenAddressKey ? (ctx) => getData(ctx, tokenAddressKey) : void 0,
      isVisible: alwaysVisible,
      includeInViews: ["confirmation"]
    },
    {
      type: "amount",
      labelKey: "confirmFieldTotalExposure",
      testId: "confirmation-total-exposure",
      getValue: (ctx) => getStreamTotalExposure(ctx) ?? 0n,
      getTokenAddress: tokenAddressKey ? (ctx) => getData(ctx, tokenAddressKey) : void 0,
      isVisible: (ctx) => getStreamTotalExposure(ctx) !== null,
      includeInViews: ["confirmation"]
    },
    {
      type: "text",
      labelKey: "confirmFieldTotalExposure",
      testId: "confirmation-total-exposure-unlimited",
      getValue: () => ({ key: "unlimited" }),
      isVisible: (ctx) => getStreamTotalExposure(ctx) === null,
      includeInViews: ["confirmation"]
    }
  ]
});
var allowanceDetailsSection = (testId, tokenAddressKey) => ({
  testId,
  elements: [
    {
      type: "amount",
      labelKey: "amount",
      testId: "review-gator-permission-amount-label",
      getValue: (ctx) => parseHexPermissionAmount(getData(ctx, "allowanceAmount")),
      getTokenAddress: tokenAddressKey ? (ctx) => getData(ctx, tokenAddressKey) : void 0,
      isVisible: alwaysVisible,
      includeInViews: ["confirmation", "reviewSummary"]
    },
    {
      type: "date",
      labelKey: "gatorPermissionsStartDate",
      testId: "review-gator-permission-start-date",
      getValue: (ctx) => getData(ctx, "startTime"),
      isVisible: alwaysVisible,
      includeInViews: ["confirmation", "reviewDetail"]
    },
    {
      type: "expiry",
      labelKey: "gatorPermissionsExpirationDate",
      testId: "review-gator-permission-expiration-date",
      getValue: (ctx) => ctx.expiry,
      isVisible: alwaysVisible,
      includeInViews: ["confirmation", "reviewDetail"]
    }
  ]
});
var erc20TokenAllowanceSchema = {
  tokenVariant: "erc20",
  tokenResolution: {
    kind: "erc20",
    getTokenAddress: (permission) => permission.data.tokenAddress
  },
  validate: requireStartTime,
  sections: [
    justificationSection,
    permissionInfoSection,
    allowanceDetailsSection(
      "erc20-token-allowance-details-section",
      "tokenAddress"
    ),
    reviewSummaryAccountSection
  ]
};
var erc20TokenPeriodicSchema = {
  tokenVariant: "erc20",
  tokenResolution: {
    kind: "erc20",
    getTokenAddress: (permission) => permission.data.tokenAddress
  },
  validate: requireStartTime,
  sections: [
    justificationSection,
    permissionInfoSection,
    periodicDetailsSection(
      "erc20-token-periodic-details-section",
      "tokenAddress"
    ),
    reviewSummaryAccountSection
  ]
};
var erc20TokenStreamSchema = {
  tokenVariant: "erc20",
  tokenResolution: {
    kind: "erc20",
    getTokenAddress: (permission) => permission.data.tokenAddress
  },
  validate: requireStartTime,
  sections: [
    justificationSection,
    permissionInfoSection,
    streamDetailsSection("erc20-token-stream-details-section", "tokenAddress"),
    streamRateSection("erc20-token-stream-stream-rate-section", "tokenAddress"),
    reviewSummaryAccountSection
  ]
};
var nativeTokenAllowanceSchema = {
  tokenVariant: "native",
  tokenResolution: { kind: "native" },
  validate: requireStartTime,
  sections: [
    justificationSection,
    permissionInfoSection,
    allowanceDetailsSection("native-token-allowance-details-section"),
    reviewSummaryAccountSection
  ]
};
var nativeTokenPeriodicSchema = {
  tokenVariant: "native",
  tokenResolution: { kind: "native" },
  validate: requireStartTime,
  sections: [
    justificationSection,
    permissionInfoSection,
    periodicDetailsSection("native-token-periodic-details-section"),
    reviewSummaryAccountSection
  ]
};
var nativeTokenStreamSchema = {
  tokenVariant: "native",
  tokenResolution: { kind: "native" },
  validate: requireStartTime,
  sections: [
    justificationSection,
    permissionInfoSection,
    streamDetailsSection("native-token-stream-details-section"),
    streamRateSection("native-token-stream-stream-rate-section"),
    reviewSummaryAccountSection
  ]
};
var TOKEN_APPROVAL_REVOCATION_METHODS = [
  {
    key: "erc20Approve",
    translationKey: "gatorPermissionsErc20ApproveRevocation"
  },
  {
    key: "erc721Approve",
    translationKey: "gatorPermissionsErc721ApproveRevocation"
  },
  {
    key: "erc721SetApprovalForAll",
    translationKey: "gatorPermissionsSetApprovalForAllRevocation"
  },
  {
    key: "permit2Approve",
    translationKey: "gatorPermissionsPermit2ApproveRevocation"
  },
  {
    key: "permit2Lockdown",
    translationKey: "gatorPermissionsPermit2Lockdown"
  },
  {
    key: "permit2InvalidateNonces",
    translationKey: "gatorPermissionsPermit2InvalidateNonces"
  }
];
var TOKEN_APPROVAL_REVOCATION_PRIMITIVE_KEYS = TOKEN_APPROVAL_REVOCATION_METHODS.map(({ key }) => key);
var makePermissionDecoderConfigs = (contracts) => {
  const enforcerAddresses = checksumEnforcerAddresses(contracts);
  return [
    makeNativeTokenStreamDecoderConfig(enforcerAddresses),
    makeNativeTokenPeriodicDecoderConfig(enforcerAddresses),
    makeNativeTokenAllowanceDecoderConfig(enforcerAddresses),
    makeErc20TokenStreamDecoderConfig(enforcerAddresses),
    makeErc20TokenPeriodicDecoderConfig(enforcerAddresses),
    makeErc20TokenAllowanceDecoderConfig(enforcerAddresses),
    makeTokenApprovalRevocationDecoderConfig(enforcerAddresses)
  ];
};
export {
  ALL_METAMASK_FACILITATOR_ADDRESSES,
  METAMASK_FACILITATOR_ADDRESSES,
  createErc20TokenAllowanceCaveats,
  makePermissionDecoderConfigs
};
