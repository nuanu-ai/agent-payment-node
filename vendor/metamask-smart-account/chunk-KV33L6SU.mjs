import { createRequire as __apnSdkCreateRequire, isBuiltin as __apnSdkIsBuiltin } from "node:module"; const __apnSdkRequire = __apnSdkCreateRequire(import.meta.url); const require = (name) => { if (typeof name !== "string" || !__apnSdkIsBuiltin(name)) throw new Error("APN SDK refuses non-builtin dynamic require"); return __apnSdkRequire(name); };
import {
  __export,
  abi12 as abi3,
  abi13 as abi4,
  abi14 as abi5,
  abi5 as abi,
  abi6 as abi2,
  getBlock,
  readContract
} from "./chunk-XRTWDKRZ.mjs";

// node_modules/@metamask/smart-accounts-kit/dist/chunk-56QPXKWD.mjs
var ERC20PeriodTransferEnforcer_exports = {};
__export(ERC20PeriodTransferEnforcer_exports, {
  read: () => read_exports
});
var read_exports = {};
__export(read_exports, {
  getAvailableAmount: () => read
});
var read = async ({
  client,
  contractAddress,
  delegationHash,
  delegationManager,
  terms
}) => {
  const [availableAmount, isNewPeriod, currentPeriod] = await readContract(
    client,
    {
      address: contractAddress,
      abi,
      functionName: "getAvailableAmount",
      args: [delegationHash, delegationManager, terms]
    }
  );
  return {
    availableAmount,
    isNewPeriod,
    currentPeriod
  };
};
var ERC20StreamingEnforcer_exports = {};
__export(ERC20StreamingEnforcer_exports, {
  read: () => read_exports2
});
var read_exports2 = {};
__export(read_exports2, {
  getAvailableAmount: () => read2
});
var read2 = async ({
  client,
  contractAddress,
  delegationManager,
  delegationHash,
  terms
}) => {
  const currentBlock = await getBlock(client);
  const currentTimestamp = currentBlock.timestamp;
  const allowanceState = await readContract(client, {
    address: contractAddress,
    abi: abi2,
    functionName: "streamingAllowances",
    args: [delegationManager, delegationHash]
  });
  const [initialAmount, maxAmount, amountPerSecond, startTime, spent] = allowanceState;
  if (startTime !== 0n) {
    const availableAmount2 = getAvailableAmount({
      initialAmount,
      maxAmount,
      amountPerSecond,
      startTime,
      spent,
      currentTimestamp
    });
    return {
      availableAmount: availableAmount2
    };
  }
  const decodedTerms = await readContract(client, {
    address: contractAddress,
    abi: abi2,
    functionName: "getTermsInfo",
    args: [terms]
  });
  const [
    ,
    decodedInitialAmount,
    decodedMaxAmount,
    decodedAmountPerSecond,
    decodedStartTime
  ] = decodedTerms;
  const availableAmount = getAvailableAmount({
    initialAmount: decodedInitialAmount,
    maxAmount: decodedMaxAmount,
    amountPerSecond: decodedAmountPerSecond,
    startTime: decodedStartTime,
    spent: 0n,
    currentTimestamp
  });
  return {
    availableAmount
  };
};
function getAvailableAmount(allowance) {
  if (allowance.currentTimestamp < allowance.startTime) {
    return 0n;
  }
  const elapsed = allowance.currentTimestamp - allowance.startTime;
  let unlocked = allowance.initialAmount + allowance.amountPerSecond * elapsed;
  if (unlocked > allowance.maxAmount) {
    unlocked = allowance.maxAmount;
  }
  if (allowance.spent >= unlocked) {
    return 0n;
  }
  return unlocked - allowance.spent;
}
var MultiTokenPeriodEnforcer_exports = {};
__export(MultiTokenPeriodEnforcer_exports, {
  read: () => read_exports3
});
var read_exports3 = {};
__export(read_exports3, {
  getAvailableAmount: () => read3
});
var read3 = async ({
  client,
  contractAddress,
  delegationHash,
  delegationManager,
  terms,
  args
}) => {
  const [availableAmount, isNewPeriod, currentPeriod] = await readContract(
    client,
    {
      address: contractAddress,
      abi: abi3,
      functionName: "getAvailableAmount",
      args: [delegationHash, delegationManager, terms, args]
    }
  );
  return {
    availableAmount,
    isNewPeriod,
    currentPeriod
  };
};
var NativeTokenPeriodTransferEnforcer_exports = {};
__export(NativeTokenPeriodTransferEnforcer_exports, {
  read: () => read_exports4
});
var read_exports4 = {};
__export(read_exports4, {
  getAvailableAmount: () => read4
});
var read4 = async ({
  client,
  contractAddress,
  delegationHash,
  delegationManager,
  terms
}) => {
  const [availableAmount, isNewPeriod, currentPeriod] = await readContract(
    client,
    {
      address: contractAddress,
      abi: abi4,
      functionName: "getAvailableAmount",
      args: [delegationHash, delegationManager, terms]
    }
  );
  return {
    availableAmount,
    isNewPeriod,
    currentPeriod
  };
};
var NativeTokenStreamingEnforcer_exports = {};
__export(NativeTokenStreamingEnforcer_exports, {
  read: () => read_exports5
});
var read_exports5 = {};
__export(read_exports5, {
  getAvailableAmount: () => read5
});
var read5 = async ({
  client,
  contractAddress,
  delegationManager,
  delegationHash,
  terms
}) => {
  const currentBlock = await getBlock(client);
  const currentTimestamp = currentBlock.timestamp;
  const allowanceState = await readContract(client, {
    address: contractAddress,
    abi: abi5,
    functionName: "streamingAllowances",
    args: [delegationManager, delegationHash]
  });
  const [initialAmount, maxAmount, amountPerSecond, startTime, spent] = allowanceState;
  if (startTime !== 0n) {
    const availableAmount2 = getAvailableAmount2({
      initialAmount,
      maxAmount,
      amountPerSecond,
      startTime,
      spent,
      currentTimestamp
    });
    return {
      availableAmount: availableAmount2
    };
  }
  const decodedTerms = await readContract(client, {
    address: contractAddress,
    abi: abi5,
    functionName: "getTermsInfo",
    args: [terms]
  });
  const [
    decodedInitialAmount,
    decodedMaxAmount,
    decodedAmountPerSecond,
    decodedStartTime
  ] = decodedTerms;
  const availableAmount = getAvailableAmount2({
    initialAmount: decodedInitialAmount,
    maxAmount: decodedMaxAmount,
    amountPerSecond: decodedAmountPerSecond,
    startTime: decodedStartTime,
    spent: 0n,
    currentTimestamp
  });
  return {
    availableAmount
  };
};
function getAvailableAmount2(allowance) {
  if (allowance.currentTimestamp < allowance.startTime) {
    return 0n;
  }
  const elapsed = allowance.currentTimestamp - allowance.startTime;
  let unlocked = allowance.initialAmount + allowance.amountPerSecond * elapsed;
  if (unlocked > allowance.maxAmount) {
    unlocked = allowance.maxAmount;
  }
  if (allowance.spent >= unlocked) {
    return 0n;
  }
  return unlocked - allowance.spent;
}

export {
  ERC20PeriodTransferEnforcer_exports,
  read_exports,
  ERC20StreamingEnforcer_exports,
  read_exports2,
  MultiTokenPeriodEnforcer_exports,
  read_exports3,
  NativeTokenPeriodTransferEnforcer_exports,
  read_exports4,
  NativeTokenStreamingEnforcer_exports,
  read_exports5
};
