import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, Note, SectionTitle } from "@/components/ui-kit";
import { supabase } from "@/integrations/supabase/client";
import { randomToken, sha256Hex, useAuth } from "@/lib/auth";
import { useBulkMeta } from "@/lib/store";
import { getRelatedProfiles, setBulkEditor } from "@/lib/privileged-rpcs.functions";

export const Route = createFileRoute("/_authenticated/bulk/access")({
  head: () => ({
    meta: [
      { title: "Access — My Bulk" },
      {
        name: "description",
        content:
          "Invite someone to your lean bulk tracker as a read-only viewer or an editor, and revoke access at any time.",
      },
      { property: "og:title", content: "Access — My Bulk" },
      { property: "og:description", content: "Owner, editor and viewer permissions." },
    ],
  }),
  component: Access,
});

type Member = { id: string; user_id: string; role: "owner" | "editor" | "viewer" };

function Access() {
  const { user } = useAuth();
  const { bulkId, role } = useBulkMeta();
  const qc = useQueryClient();
  const isOwner = role === "owner";

  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"viewer" | "editor">("viewer");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const members = useQuery({
    enabled: !!bulkId,
    queryKey: ["bulk-members", bulkId],
    queryFn: async () => {
      const [{ data: rows }, profiles] = await Promise.all([
        supabase.from("bulk_members").select("id,user_id,role").eq("bulk_profile_id", bulkId!),
        getRelatedProfiles(),
      ]);
      const names = new Map(
        profiles.map((p) => [p.id, p.display_name || p.email || "Member"]),
      );
      return ((rows ?? []) as Member[]).map((m) => ({
        ...m,
        name: names.get(m.user_id) ?? "Member",
      }));
    },
  });

  const invites = useQuery({
    enabled: !!bulkId && isOwner,
    queryKey: ["bulk-invites", bulkId],
    queryFn: async () => {
      const { data } = await supabase
        .from("bulk_invitations")
        .select("id,invited_email,role,expires_at,accepted_at,revoked_at")
        .eq("bulk_profile_id", bulkId!)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const invite = async () => {
    if (!bulkId || !user) return;
    setBusy(true);
    setError(null);
    try {
      const token = randomToken();
      const { error } = await supabase.from("bulk_invitations").insert({
        bulk_profile_id: bulkId,
        invited_email: email.trim().toLowerCase(),
        role: inviteRole,
        token_hash: await sha256Hex(token),
        expires_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
        created_by: user.id,
      });
      if (error) throw error;
      setLink(`${window.location.origin}/invite/bulk/${token}`);
      setEmail("");
      await qc.invalidateQueries({ queryKey: ["bulk-invites"] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleEditor = async (userId: string, editor: boolean) => {
    if (!bulkId) return;
    await setBulkEditor({ data: { bulk: bulkId, user: userId, editor } });
    await qc.invalidateQueries({ queryKey: ["bulk-members"] });
  };

  const remove = async (id: string) => {
    await supabase.from("bulk_members").delete().eq("id", id);
    await qc.invalidateQueries({ queryKey: ["bulk-members"] });
  };

  const revoke = async (id: string) => {
    await supabase
      .from("bulk_invitations")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);
    await qc.invalidateQueries({ queryKey: ["bulk-invites"] });
  };

  return (
    <AppShell>
      <PageHeader title="Access" subtitle="Who can see and edit your bulk tracker." />

      <Card>
        <SectionTitle>People</SectionTitle>
        <div className="space-y-2">
          {(members.data ?? []).map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between rounded-xl border border-border bg-elevated px-3 py-2"
            >
              <div>
                <p className="text-sm font-medium">
                  {m.user_id === user?.id ? "Me" : m.name}
                </p>
                <p className="text-[11px] capitalize text-muted-foreground">{m.role}</p>
              </div>
              {isOwner && m.role !== "owner" ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void toggleEditor(m.user_id, m.role !== "editor")}
                    className="rounded-lg border border-border px-2 py-1 text-[11px] font-medium"
                  >
                    {m.role === "editor" ? "Make viewer" : "Make editor"}
                  </button>
                  <button
                    onClick={() => void remove(m.id)}
                    className="rounded-lg px-2 py-1 text-[11px] font-medium text-danger"
                  >
                    Remove
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <Note>
          Viewers can read everything but cannot change anything. Editors can log data. Only the
          owner manages access, and the owner cannot be removed or transferred.
        </Note>
      </Card>

      {isOwner ? (
        <Card className="mt-3 space-y-3">
          <SectionTitle>Invite someone</SectionTitle>
          <input
            type="email"
            value={email}
            placeholder="friend@email.com"
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-border bg-elevated px-3 py-2.5 text-sm outline-none"
          />
          <div className="grid grid-cols-2 gap-2">
            {(["viewer", "editor"] as const).map((r) => (
              <button
                key={r}
                onClick={() => setInviteRole(r)}
                className={`rounded-xl border py-2 text-sm capitalize ${
                  inviteRole === r
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-elevated"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
          {error ? <p className="text-xs text-danger">{error}</p> : null}
          <button
            disabled={busy || !email}
            onClick={() => void invite()}
            className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            Create invitation link
          </button>
          {link ? (
            <div className="rounded-xl border border-border bg-elevated p-3">
              <p className="break-all text-xs">{link}</p>
              <button
                onClick={() => void navigator.clipboard.writeText(link)}
                className="mt-2 text-xs font-semibold text-primary"
              >
                Copy link
              </button>
            </div>
          ) : null}

          <div className="space-y-2">
            {(invites.data ?? []).map((i) => {
              const state = i.revoked_at
                ? "Revoked"
                : i.accepted_at
                  ? "Accepted"
                  : new Date(i.expires_at) < new Date()
                    ? "Expired"
                    : "Pending";
              return (
                <div
                  key={i.id}
                  className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-xs"
                >
                  <span>
                    {i.invited_email} · {i.role}
                  </span>
                  <span className="flex items-center gap-2 text-muted-foreground">
                    {state}
                    {state === "Pending" ? (
                      <button onClick={() => void revoke(i.id)} className="text-danger">
                        Revoke
                      </button>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      ) : (
        <Note>Only the owner can manage access to this tracker.</Note>
      )}
    </AppShell>
  );
}
