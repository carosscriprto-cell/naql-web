"use client";

import { useEffect } from "react";

import { mocksReady } from "@/mocks/init";

// Starts the MSW worker (only when env.NEXT_PUBLIC_USE_MOCKS === "true" —
// mocksReady is a no-op otherwise). Children render immediately; api
// functions await mocksReady() themselves, so nothing races the worker.
export function MockProvider({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  useEffect(() => {
    void mocksReady();
  }, []);

  return <>{children}</>;
}
