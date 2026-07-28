// Runs the Supabase CLI against the hosted DEV project over the TRANSACTION
// pooler, for READ-ONLY commands only.
//
// WHY 6543 AND NOT 5432. Outbound TCP/5432 is blackholed on this network: the
// SYN/SYN-ACK completes (so `Test-NetConnection` reports TcpTestSucceeded:True
// and lies), then every payload byte is dropped. Proven by sending an 8-byte
// SSLRequest to the SAME peer IP on both ports — 6543 replies "S" in
// milliseconds, 5432 times out; identical on both pooler generations
// (aws-0-*, aws-1-*) across four IPs, three repeats, with no local firewall
// rule. So the port is the only variable, and 6543 is the one that works.
//
// Transaction mode cannot carry DDL safely — no session state, no advisory
// locks. `migration up` therefore runs in CI only, over the session pooler:
// .github/workflows/db-migrate.yml. This script refuses to run it.
//
// ENCODING CONVENTION (settled by measurement, not assumption): the password
// inside SUPABASE_DB_URL is stored ALREADY percent-encoded exactly once —
// decodeURIComponent(uriPassword) === SUPABASE_DB_PASSWORD, and
// encodeURIComponent(SUPABASE_DB_PASSWORD) === uriPassword, with no residual
// %XX after one decode. This script therefore passes the URI through UNCHANGED
// and never re-encodes it; encoding here would double-encode and break auth.
//
// The URI is never printed and never placed on a command line: it is handed to
// the child process through an argv array, so it does not enter shell history.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const KEY = "SUPABASE_DB_URL";
const ENV_FILE = ".env.test";

/** Read one key out of .env.test without pulling in a dotenv dependency. */
function readEnvValue(key) {
  let raw;
  try {
    raw = readFileSync(ENV_FILE, "utf8");
  } catch {
    throw new Error(
      `Missing ${ENV_FILE}. Copy .env.example to ${ENV_FILE} and fill it in — it must point at the hosted DEV Supabase project.`,
    );
  }
  const match = raw.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!match) {
    throw new Error(
      `Missing env var ${key}. Set it in ${ENV_FILE} (see .env.example) — it must point at the hosted DEV Supabase project.`,
    );
  }
  return match[1].trim().replace(/^["']|["']$/g, "");
}

const url = readEnvValue(KEY);

// --- guards, each with its own named error --------------------------------
// Order matters: shape first, so later guards can trust the captured groups.

if (url === "") {
  throw new Error(
    `${KEY} is empty. Set it in ${ENV_FILE} (see .env.example) — the DEV transaction-pooler URI, port 6543.`,
  );
}

const shape = url.match(
  /^(postgres(?:ql)?):\/\/([^:]+):([^@]*)@([^:/]+):(\d+)\/(.+)$/,
);
if (!shape) {
  throw new Error(
    `${KEY} is malformed. Expected postgres://user:password@host:port/database — check ${ENV_FILE}.`,
  );
}
const [, , , password, hostname, port] = shape;
const host = `${hostname}:${port}`;

if (/\[YOUR-PASSWORD\]/i.test(url)) {
  throw new Error(
    `${KEY} still contains the [YOUR-PASSWORD] placeholder — paste the real DEV database password into ${ENV_FILE}.`,
  );
}

if (password === "") {
  throw new Error(
    `${KEY} has an empty password. Paste the real DEV database password into ${ENV_FILE}.`,
  );
}

// 5432 is blackholed on this network; 6543 (transaction mode) is read-only-safe.
// migration up runs in CI (.github/workflows/db-migrate.yml), never from here.
if (!host.endsWith(":6543")) {
  throw new Error(
    `${KEY} must use the transaction pooler (6543) — reads only`,
  );
}

const args = process.argv.slice(2);
const command = args.join(" ");

const readOnly = ["migration list", "inspect"];
if (!readOnly.some((c) => command.startsWith(c))) {
  throw new Error(
    "write commands are not allowed over the transaction pooler — use the CI workflow",
  );
}

// --- run -------------------------------------------------------------------
// The locally pinned CLI is a Node shim, so it is spawned with `process.execPath`
// and shell:false. That matters on Windows: `npx` there resolves to npx.cmd,
// which Node can only launch through cmd.exe (shell:true) — and cmd.exe would
// both re-lex the URI onto a command line and treat its `%` escapes as variable
// expansion. Going straight to node keeps the URI inside argv, unparsed.
const require = createRequire(import.meta.url);
let cli;
try {
  cli = require.resolve("supabase/dist/supabase.js");
} catch {
  throw new Error(
    "Supabase CLI not installed. Run `npm ci` — it is the pinned `supabase` devDependency.",
  );
}

const result = spawnSync(
  process.execPath,
  [cli, ...args, "--db-url", url],
  { stdio: "inherit" },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
