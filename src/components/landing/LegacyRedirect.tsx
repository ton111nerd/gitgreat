"use client";

import { useEffect } from "react";

/** Old explorer links pointed at "/?repo=…" – forward them to /explore. */
export default function LegacyRedirect() {
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (["repo", "view", "period", "q", "cat"].some((k) => sp.has(k))) {
      window.location.replace(`/explore?${sp.toString()}`);
    }
  }, []);
  return null;
}
