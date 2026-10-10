export function changeTimelineRange(start, end, edge, delta, duration, minimum) {
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  minimum = Math.min(duration, minimum);
  if (edge === 'left') start = clamp(start + delta, 0, end - minimum);
  else if (edge === 'right') end = clamp(end + delta, start + minimum, duration);
  else {
    const length = end - start;
    start = clamp(start + delta, 0, duration - length);
    end = start + length;
  }
  return {start, end};
}
