/**
 * Test-only console capture (imported by *.test.ts files only; never by a
 * function entrypoint).
 *
 * Every argument is rendered with Deno.inspect at full depth, the same way
 * the real console prints it, so a secret inside URLSearchParams, an Error,
 * Headers or a nested object is visible to a leak assertion. JSON.stringify
 * would render those as `{}` and hide the leak (PR 54 review R-8).
 */
export async function captureLogs<T>(run: () => Promise<T>): Promise<{ result: T; logs: string }> {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  const lines: string[] = [];
  const capture = (...args: unknown[]) => {
    lines.push(
      args.map((a) =>
        typeof a === "string"
          ? a
          : Deno.inspect(a, { depth: Infinity, iterableLimit: Infinity, strAbbreviateSize: Infinity })
      ).join(" "),
    );
  };
  console.log = capture;
  console.info = capture;
  console.warn = capture;
  console.error = capture;
  console.debug = capture;
  try {
    return { result: await run(), logs: lines.join("\n") };
  } finally {
    Object.assign(console, original);
  }
}

/** Fails if any of `secrets` appears in `logs` (without echoing the secret). */
export function assertNoSecretsLogged(logs: string, secrets: readonly string[]): void {
  for (const secret of secrets) {
    if (logs.includes(secret)) {
      throw new Error(`secret leaked into logs: ${secret.slice(0, 6)}…`);
    }
  }
}
