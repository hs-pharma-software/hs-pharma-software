"use client";

import { Topbar } from "./Topbar";
import { PageTransition } from "./PageTransition";

/** Chrome for a Sub Super (software distributor): the top bar only. They have
 * no business sections, so there is no sidebar. */
export function SubSuperShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen flex-col bg-neutral-100">
      <Topbar />
      <main className="min-w-0 flex-1 overflow-y-auto p-5">
        <PageTransition>{children}</PageTransition>
      </main>
    </div>
  );
}
