export const PULL_REFRESH_THRESHOLD = 72;
export const PULL_REFRESH_HOLD_DISTANCE = 52;
export const PULL_REFRESH_MAX_DISTANCE = 112;

export function pullGesture(
  start: { x: number; y: number },
  current: { x: number; y: number },
  scrollY: number,
) {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  if (scrollY > 0 || dy <= 12) return { distance: 0, cancelled: false, ready: false };
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10)
    return { distance: 0, cancelled: true, ready: false };
  const pull = dy - 12;
  const distance = Math.min(
    PULL_REFRESH_MAX_DISTANCE,
    PULL_REFRESH_MAX_DISTANCE * (1 - Math.exp(-pull / 130)),
  );
  return { distance, cancelled: false, ready: distance >= PULL_REFRESH_THRESHOLD };
}
