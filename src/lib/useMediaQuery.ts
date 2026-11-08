import { useSyncExternalStore } from "react";

/** Whether a CSS media query matches, kept up to date as the window resizes
 * or the phone rotates. False on the server and in the first client render,
 * so markup always hydrates the same. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false),
    () => false,
  );
}

/** Phone-width screens: the same breakpoint as Tailwind's `max-sm` and the
 * phone rules in globals.css. */
export const PHONE_QUERY = "(max-width: 639.98px)";
