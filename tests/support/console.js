import { format } from "node:util";

// Return the messages logged with console[method] ("error" or "warn") so far
// in this test, and clear them so the console guard accepts them
export function takeConsoleCalls(method) {
  const spy = console[method];
  const messages = spy.mock.calls.map((args) => format(...args));
  spy.mockClear();
  return messages;
}
