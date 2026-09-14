"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Registration is now just the wallet-connect flow — connecting a new wallet
// creates the account automatically on the backend's /auth/verify call.
export default function RegisterPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/login");
  }, [router]);
  return null;
}
