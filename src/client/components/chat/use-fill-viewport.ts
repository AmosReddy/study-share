import { useEffect, type RefObject } from "react";

/** Never shorter than this (about 18rem), so the chat stays usable in a landscape phone with the keyboard open. */
const MIN_HEIGHT = 288;
/** Space left under the chat on a wide screen. */
const DESKTOP_GAP = 16;
const TAB_BAR = 'nav[aria-label="Group sections"]';

/**
 * Makes the element as tall as the part of the screen that is left under it: from its own top to
 * the bottom of what the person can see, which is the top of the fixed tab bar on a phone, and the
 * bottom of the VISIBLE viewport (so the on-screen keyboard is not under it). The messages scroll
 * inside it and the composer stays in view, while the page itself does not scroll.
 *
 * It measures and writes the height straight onto the element (no state, no re-render), again
 * whenever the window, the visual viewport (keyboard, browser bars) or the page's own size changes.
 * The CSS height on the element is only what shows until this runs.
 */
export function useFillViewport(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const viewport = window.visualViewport;

    function fit() {
      if (!element) return;
      // The visible part of the page, in the layout viewport's coordinates.
      let bottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
      const tabBar = document.querySelector<HTMLElement>(TAB_BAR);
      if (tabBar && getComputedStyle(tabBar).position === "fixed") {
        // Above the bar; with the keyboard open the bar is behind it and the keyboard's top wins.
        bottom = Math.min(bottom, tabBar.getBoundingClientRect().top);
      } else {
        bottom -= DESKTOP_GAP;
      }
      const height = Math.max(MIN_HEIGHT, Math.floor(bottom - element.getBoundingClientRect().top));
      if (Math.abs(height - element.getBoundingClientRect().height) > 0.5) element.style.height = `${height}px`;
    }

    fit();
    window.addEventListener("resize", fit);
    viewport?.addEventListener("resize", fit);
    viewport?.addEventListener("scroll", fit);
    // What is above the chat (the group's name and description) can change height as fonts load.
    const observer = new ResizeObserver(fit);
    observer.observe(document.documentElement);
    return () => {
      window.removeEventListener("resize", fit);
      viewport?.removeEventListener("resize", fit);
      viewport?.removeEventListener("scroll", fit);
      observer.disconnect();
    };
  }, [ref]);
}
