import { createFileRoute } from "@tanstack/react-router";
import { MyWorkoutsPage } from "@/components/MyWorkouts";

export const Route = createFileRoute("/_authenticated/bulk/training_/workouts")({
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: MyWorkoutsPage,
});
