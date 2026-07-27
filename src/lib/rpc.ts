import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import type { Database } from "@/types/database";
import { ApiError } from "./api-error";
import { unwrap } from "./envelope";

type PublicFunctions = Database["public"]["Functions"];

/** Any RPC in the generated schema — a typo is a compile error, not a 404. */
export type RpcName = string & keyof PublicFunctions;
type RpcArgs<N extends RpcName> = PublicFunctions[N]["Args"];

/** One of the three trust-boundary clients in `lib/supabase/`. */
export type NaqlClient = SupabaseClient<Database>;

/**
 * The client is an explicit argument, not an import inside this file: which
 * identity an RPC runs as is the decision that matters here (see the file
 * comments in `lib/supabase/`), so it stays visible at the call site.
 */

/**
 * A supabase-js `error` is a *transport* failure — the RPC never returned a
 * body. Domain failures are HTTP 200 with `{ ok: false }` and are raised by
 * `unwrap()` with their own code (BACKEND_V1 §0). `NETWORK_ERROR` is therefore
 * not in the §0 code list: it means "no answer", not "the answer was no".
 */
function transportError(name: RpcName, error: PostgrestError): never {
  throw new ApiError("NETWORK_ERROR", `RPC ${name} failed: ${error.message}`, {
    rpc: name,
    pgCode: error.code,
    details: error.details,
    hint: error.hint,
  });
}

/**
 * Call an **enveloped** RPC — one with a real domain failure mode, which
 * returns `{ ok, data } | { ok, error }`: `get_trip`, `get_seat_map`,
 * `lock_seats`, `release_lock`, `create_booking`, `cancel_booking`,
 * `lookup_booking`, `get_booking`.
 *
 * Envelope handling is `lib/envelope.ts` `unwrap()` — the same code path the
 * MSW era uses, so `ApiError.code` reaches the UI unchanged either way.
 */
export async function callRpc<N extends RpcName, T>(
  client: NaqlClient,
  name: N,
  args: RpcArgs<N>,
  schema: z.ZodType<T>,
): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) transportError(name, error);
  return unwrap(data, schema);
}

/**
 * Call a **bare** RPC — one that cannot fail in a domain sense and so returns
 * its payload directly, with no envelope. `search_trips` is the only one in v1
 * (BACKEND_V1 §2: a list read for one route+date). PostgREST table reads are
 * bare too, but those go through `client.from(...)` and need no helper.
 */
export async function callRpcBare<N extends RpcName, T>(
  client: NaqlClient,
  name: N,
  args: RpcArgs<N>,
  schema: z.ZodType<T>,
): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) transportError(name, error);
  return schema.parse(data);
}
