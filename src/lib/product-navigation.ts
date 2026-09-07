export type ProductArea = "challenge" | "training" | "meals" | "goal";

export const PRODUCT_LANDING_ROUTES = {
  challenge: "/challenge",
  training: "/bulk/training",
  meals: "/bulk/meals",
  goal: "/bulk",
} as const;

export function productAreaForPath(pathname: string): ProductArea {
  if (pathname.startsWith("/challenge")) return "challenge";
  if (
    pathname.startsWith("/bulk/training") ||
    pathname.startsWith("/bulk/workout") ||
    pathname.startsWith("/bulk/exercises") ||
    pathname.startsWith("/bulk/prs")
  )
    return "training";
  if (pathname.startsWith("/bulk/meals") || pathname.startsWith("/bulk/history")) return "meals";
  if (pathname.startsWith("/bulk")) return "goal";
  return "challenge";
}
