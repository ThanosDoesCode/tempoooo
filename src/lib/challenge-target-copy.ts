/** Display estimate only; Challenge scoring continues to use the selected km target. */
export function weeklyTargetHelper(targetKm: number): string {
  const runs = Number((targetKm / 5).toFixed(1));
  return `About ${runs} easy 5 km ${runs === 1 ? "run" : "runs"} a week. Rides count at a third.`;
}
