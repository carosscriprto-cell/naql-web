"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

import { signIn } from "../api";
import type { LoginFormValues } from "../schemas";

/**
 * OPR-0. `next` is the already-sanitised destination (see `safeOperatorPath`).
 *
 * `refresh()` after `replace()` is not belt-and-braces: the guard and the shell
 * are Server Components that read the cookie this sign-in just wrote, and the
 * client router would otherwise hand back the RSC payload it cached while
 * signed out — the portal would render logged-out chrome until a hard reload.
 */
export function useSignIn(next: string) {
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (values: LoginFormValues) => signIn(values),
    onSuccess: () => {
      // Anything cached under the previous identity (an anonymous passenger's
      // seat maps, another operator's trips) belongs to that identity only.
      queryClient.clear();
      router.replace(next);
      router.refresh();
    },
  });
}
