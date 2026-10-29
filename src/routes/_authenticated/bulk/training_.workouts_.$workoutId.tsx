import { createFileRoute } from "@tanstack/react-router";
import { PrivateWorkoutPage } from "@/components/MyWorkouts";

export const Route = createFileRoute("/_authenticated/bulk/training_/workouts_/$workoutId")({
  validateSearch: (search: Record<string, unknown>) => ({ edit: search["edit"] === true }),
  head: () => ({ meta: [{ title: "Tempo" }] }),
  component: WorkoutRoute,
});
function WorkoutRoute() {
  const { workoutId } = Route.useParams();
  const { edit } = Route.useSearch();
  return <PrivateWorkoutPage workoutId={workoutId} edit={edit} />;
}
