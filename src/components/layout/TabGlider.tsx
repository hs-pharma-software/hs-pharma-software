"use client";

import { useEffect } from "react";

/** Every tab bar in MAVIN (an element with role="tablist" whose tabs carry
 * aria-selected) gets a short accent bar under the selected tab that glides to
 * the newly selected one. Mounted once for the whole app, so each page keeps
 * its own tab markup. On a narrow tab bar that scrolls sideways, the selected
 * tab is also scrolled into view. A tab bar can opt out with data-no-glider. */
export function TabGlider() {
  useEffect(() => {
    const lastTab = new WeakMap<HTMLElement, HTMLElement>();
    let frame = 0;

    const place = () => {
      frame = 0;
      document.querySelectorAll<HTMLElement>('[role="tablist"]').forEach((list) => {
        if (list.hasAttribute("data-no-glider")) return;
        const tab = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
        let bar = list.querySelector<HTMLElement>(":scope > .tab-glider");
        if (!tab || tab.offsetParent === null) {
          if (bar) bar.style.opacity = "0";
          return;
        }
        if (!bar) {
          if (getComputedStyle(list).position === "static") list.style.position = "relative";
          bar = document.createElement("span");
          bar.className = "tab-glider";
          bar.setAttribute("aria-hidden", "true");
          list.appendChild(bar);
        }
        const lr = list.getBoundingClientRect();
        const tr = tab.getBoundingClientRect();
        const w = Math.max(tr.width * 0.5, 12);
        const x = tr.left - lr.left - list.clientLeft + list.scrollLeft + (tr.width - w) / 2;
        const y = tr.bottom - lr.top - list.clientTop + list.scrollTop - 4;
        bar.style.width = `${w}px`;
        bar.style.transform = `translate(${x}px, ${y}px)`;
        bar.style.opacity = "1";
        // Glide only from the second placement on (no slide in from the corner).
        if (!bar.dataset.ready) requestAnimationFrame(() => { if (bar) bar.dataset.ready = "1"; });

        const prev = lastTab.get(list);
        if (prev !== tab) {
          lastTab.set(list, tab);
          if (prev && list.scrollWidth > list.clientWidth + 1) {
            const left = tab.offsetLeft - (list.clientWidth - tab.offsetWidth) / 2;
            list.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
          }
        }
      });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-selected", "class", "hidden"] });
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return null;
}
