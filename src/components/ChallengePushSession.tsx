import { useEffect } from "react";
import { watchChallengePushSession } from "@/lib/challenge-push";

export function ChallengePushSession() {
  useEffect(() => watchChallengePushSession(), []);
  return null;
}
