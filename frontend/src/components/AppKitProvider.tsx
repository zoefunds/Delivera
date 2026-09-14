"use client";

import { useEffect } from "react";
import { initAppKit } from "@/lib/appkit";

export function AppKitProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initAppKit();
  }, []);

  return <>{children}</>;
}
