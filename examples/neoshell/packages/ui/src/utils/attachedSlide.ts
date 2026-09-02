import { cubicOut } from "svelte/easing";

export function attachedSlide(node: Element, { duration = 150 } = {}) {
  return {
    duration,
    easing: cubicOut,
    css: (t: number) =>
      `clip-path: inset(0 -9999px ${(1 - t) * 100}% -9999px);`,
  };
}
