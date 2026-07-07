import { env } from "@/config/env";

const mocksEnabled = env.NEXT_PUBLIC_USE_MOCKS === "true";

let startPromise: Promise<unknown> | null = null;

/**
 * Resolves once MSW intercepts requests. Immediately resolved when mocks are
 * off or on the server. Awaited by feature api functions so the first query
 * can't race the service worker registration.
 */
export function mocksReady(): Promise<unknown> {
  if (!mocksEnabled || typeof window === "undefined") {
    return Promise.resolve();
  }
  startPromise ??= import("./browser").then(({ worker }) =>
    worker.start({ onUnhandledRequest: "bypass" }),
  );
  return startPromise;
}
