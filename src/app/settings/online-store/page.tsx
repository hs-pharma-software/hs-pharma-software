"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** The old "My Online Store" list moved into Settings > Website > Products &
 * Store, where each business lists products for itself only. */
export default function OnlineStoreMovedPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/settings/website"); }, [router]);
  return <p className="p-4 text-sm text-neutral-500">The online store is now under Settings → Website…</p>;
}
