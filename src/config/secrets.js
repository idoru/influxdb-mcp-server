import { readFileSync } from "node:fs";

// Read a secret from env[name], or from the file named by env[`${name}_FILE`]
// (Docker and Kubernetes secrets), so it need not appear in the process
// environment, shell history or `docker inspect`. File contents are trimmed.
// Throws if both are set or the file cannot be read.
export function readSecret(env, name) {
  const value = env[name] || undefined;
  const file = env[`${name}_FILE`] || undefined;
  if (value && file) {
    throw new Error(`Set only one of ${name} and ${name}_FILE.`);
  }
  if (!file) return value;

  let contents;
  try {
    contents = readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`Could not read ${name}_FILE (${error.code || error.message}).`);
  }
  return contents.trim() || undefined;
}
