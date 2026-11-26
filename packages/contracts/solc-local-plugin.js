// Hardhat plugin: use locally cached soljson.js (npm solc@0.6.11) instead of downloading binaries.
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

const LOCAL = {
  "0.6.11": "/tmp/solcbuild/package/soljson.js",
  "0.4.23": "/tmp/solcbuild/p0.4.23/soljson.js",
  "0.5.17": "/tmp/solcbuild/p0.5.17/soljson.js",
};

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async ({ solcVersion }) => {
  const p = LOCAL[solcVersion];
  if (!p) {
    throw new Error(`No local solc for ${solcVersion}`);
  }
  return {
    compilerPath: p,
    isSolcJs: true,
    version: solcVersion,
    longVersion: solcVersion,
  };
});
