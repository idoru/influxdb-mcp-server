// Loaded for every suite through setupFilesAfterEnv in jest.config.js.
//
// A test fails if it writes to console.error or console.warn, unless it takes
// those messages with takeConsoleCalls() (tests/support/console.js) and
// asserts on them. Expected error logs stay out of the output, and unexpected
// ones cannot pass unnoticed.
//
// This file must not import @jest/globals: in ESM mode Jest caches that
// module for the first importer, and test files would then resolve relative
// jest.unstable_mockModule() paths from tests/support/. It uses the injected
// beforeEach/afterEach and its own import.meta.jest instead.
import { format } from "node:util";

const { jest } = import.meta;
const GUARDED_METHODS = ["error", "warn"];

beforeEach(() => {
  for (const method of GUARDED_METHODS) {
    jest.spyOn(console, method).mockImplementation(() => {});
  }
});

afterEach(() => {
  const unexpected = [];
  for (const method of GUARDED_METHODS) {
    const spy = console[method];
    if (!jest.isMockFunction(spy)) continue;
    unexpected.push(...spy.mock.calls.map((args) => `console.${method}: ${format(...args)}`));
    spy.mockRestore();
  }
  if (unexpected.length > 0) {
    throw new Error(
      "Unexpected console output. Take expected messages with takeConsoleCalls() and assert on them.\n" +
        unexpected.join("\n"),
    );
  }
});
