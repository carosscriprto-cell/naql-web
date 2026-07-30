"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { signOut } from "../api";

/**
 * OPR-0. Clearing the cache is the security-relevant half: operator data is
 * company-scoped, and a shared office machine signs the next operator in
 * against the same in-memory QueryClient.
 */
export function useSignOut() {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.clear();
      router.replace("/operator/login");
      router.refresh();
    },
  });
}
