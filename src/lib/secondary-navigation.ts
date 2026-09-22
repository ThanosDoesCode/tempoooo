export const secondaryNavigationSlot = (index: number, active: number, count: number) => {
  const relative = (index - active + count) % count;
  if (relative === 0) return 0;
  if (relative <= count / 2) return relative === count / 2 ? -relative : relative;
  return relative - count;
};
