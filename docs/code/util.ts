export interface Range { start: number; end: number }

export function clamp(n: number, { start, end }: Range): number {
  return Math.min(end, Math.max(start, n));
}
