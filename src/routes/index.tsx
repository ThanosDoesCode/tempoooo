import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lean Bulk Tracker — bulk and challenge" },
      {
        name: "description",
        content:
          "A private lean bulk tracker plus a two-person 52-week running and cycling challenge with weekly targets and penalties.",
      },
      { property: "og:title", content: "Lean Bulk Tracker — bulk and challenge" },
      {
        property: "og:description",
        content: "A private lean bulk tracker plus a two-person 52-week running and cycling challenge with weekly targets and penalties.",
      },
    ],
  }),
  component: Entry,
});

function Entry() {
  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        window.location.href = "/auth";
        return;
      }
      const { data: members } = await supabase.from("bulk_members").select("bulk_profile_id");
      window.location.href = members && members.length > 0 ? "/bulk" : "/challenge";
    })();
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="h-10 w-10 animate-pulse rounded-full bg-card" />
    </div>
  );
}
