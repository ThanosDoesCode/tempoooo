import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    throw redirect({ to: data.session ? "/challenge" : "/auth" });
  },
  head: () => ({
    meta: [
      { title: "Tempo" },
      {
        name: "description",
        content:
          "A focused two-person 52-week running and cycling challenge with weekly targets and penalties.",
      },
      { property: "og:title", content: "Tempo" },
      {
        property: "og:description",
        content:
          "A focused two-person 52-week running and cycling challenge with weekly targets and penalties.",
      },
    ],
  }),
  component: () => null,
});
