import { useEffect, useState } from "react";
import { iso } from "./calc";

/** Existing Goal calendar: browser-local date, refreshed after midnight/PWA resume. */
export function useLocalDay() {
  const [day, setDay] = useState(() => iso(new Date()));
  useEffect(() => {
    const refresh = () => setDay(iso(new Date()));
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return day;
}
