/** Shared motion timing, so every animation in MAVIN has the same rhythm.
 * Arrivals decelerate (ease out), departures accelerate (ease in), and an exit
 * takes about two thirds of the matching entrance. The same values are CSS
 * variables in globals.css (--dur-*, --ease-*). */
export const DUR = { fast: 0.12, base: 0.18, slow: 0.26 } as const;
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const EASE_IN = [0.4, 0, 1, 1] as const;
/** Springs for things that move under the hand: presses, sheets, dialogs. */
export const SPRING_PRESS = { type: "spring", stiffness: 500, damping: 32 } as const;
export const SPRING_PANEL = { type: "spring", stiffness: 380, damping: 32 } as const;
