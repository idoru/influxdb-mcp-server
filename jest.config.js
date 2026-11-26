export default {
  testEnvironment: "node",
  transform: {},
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  testTimeout: 60000,
  // Fails tests that log to console.error or console.warn unexpectedly
  setupFilesAfterEnv: ["<rootDir>/tests/support/console-guard.js"],
  transformIgnorePatterns: [],
  resolver: undefined,
};
