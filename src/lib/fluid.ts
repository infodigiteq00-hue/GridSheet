/** Pointer physics helpers from Apple's Designing Fluid Interfaces, for the web. */

export const DRAG_THRESHOLD = 10;
export const SPRING_MOVE = { type: "spring" as const, bounce: 0, duration: 0.4 };
export const SPRING_FLICK = { type: "spring" as const, bounce: 0.2, duration: 0.4 };

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Exponential-decay projection Apple ships (not v²/2a). */
export function project(initialVelocity: number, decelerationRate = 0.998): number {
  return (initialVelocity / 1000) * decelerationRate / (1 - decelerationRate);
}

export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0) return 0;
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

export function rubberClamp(value: number, min: number, max: number, dimension: number): number {
  if (value < min) return min - rubberband(min - value, dimension);
  if (value > max) return max + rubberband(value - max, dimension);
  return value;
}

export function createVelocityTracker() {
  const samples: { t: number; x: number; y: number }[] = [];

  return {
    reset() {
      samples.length = 0;
    },
    add(x: number, y: number) {
      const t = performance.now();
      samples.push({ t, x, y });
      while (samples.length > 6) samples.shift();
      const cutoff = t - 80;
      while (samples.length > 2 && samples[0].t < cutoff) samples.shift();
    },
    velocity(): { vx: number; vy: number } {
      if (samples.length < 2) return { vx: 0, vy: 0 };
      const a = samples[0];
      const b = samples[samples.length - 1];
      const dt = Math.max(16, b.t - a.t) / 1000;
      return { vx: (b.x - a.x) / dt, vy: (b.y - a.y) / dt };
    },
  };
}

export function moveIdBefore(ids: string[], movingId: string, targetId: string): string[] {
  if (movingId === targetId) return ids;
  const next = ids.filter((id) => id !== movingId);
  const i = next.indexOf(targetId);
  if (i < 0) return ids;
  next.splice(i, 0, movingId);
  return next;
}

export function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
