"use client";

import { usePathname, useSelectedLayoutSegments } from "next/navigation";
import { isPublicPath } from "@/lib/publicPaths";

/** Whether the current page is public (no sign-in, no app chrome).
 *
 * On the corporate domain the proxy serves /about from src/app/site/about, but
 * during server rendering the pathname is the visitor's (/about), which does
 * not look public. The route segment does: it is "site" on the server and in
 * the browser alike, so search engines get the page itself, not a sign-in
 * spinner. */
export function usePublicPage(): boolean {
  const pathname = usePathname();
  const segments = useSelectedLayoutSegments();
  return segments[0] === "site" || isPublicPath(pathname);
}
