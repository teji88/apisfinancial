import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useEntitlement, formatDate } from "@/lib/entitlement";
import {
  createInviteCodes,
  listInviteCodes,
  revokeInviteCode,
} from "@/lib/entitlement.functions";

export const Route = createFileRoute("/_authenticated/invites")({
  head: () => ({
    meta: [
      { title: "Invite codes — MapleWealth" },
      {
        name: "description",
        content: "Create and manage free-access invite codes for friends and testers.",
      },
      { property: "og:title", content: "Invite codes — MapleWealth" },
      {
        property: "og:description",
        content: "Hand out codes that unlock MapleWealth Pro at no charge.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: InvitesPage,
});

function InvitesPage() {
  const { entitlement, loading } = useEntitlement();
  const list = useServerFn(listInviteCodes);
  const create = useServerFn(createInviteCodes);
  const revoke = useServerFn(revokeInviteCode);
  const qc = useQueryClient();

  const [count, setCount] = useState(1);
  const [maxUses, setMaxUses] = useState(1);
  const [note, setNote] = useState("");
  const [accessUntil, setAccessUntil] = useState("");

  const codes = useQuery({
    queryKey: ["invite-codes"],
    enabled: entitlement.isAdmin,
    queryFn: async () => list({}),
  });

  const createMutation = useMutation({
    mutationFn: async () =>
      create({
        data: {
          count,
          maxUses,
          note,
          accessUntil: accessUntil ? new Date(`${accessUntil}T23:59:59`).toISOString() : null,
        },
      }),
    onSuccess: (result) => {
      toast.success(`Created ${result.codes.length} code(s)`);
      setNote("");
      void qc.invalidateQueries({ queryKey: ["invite-codes"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Could not create codes"),
  });

  const revokeMutation = useMutation({
    mutationFn: async (input: { id: string; revoked: boolean }) => revoke({ data: input }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["invite-codes"] }),
  });

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  if (!entitlement.isAdmin) {
    return (
      <div className="rounded-lg border p-6">
        <h1 className="text-lg font-semibold">Invite codes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This page is only available to the MapleWealth owner.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Invite codes</h1>
        <p className="text-sm text-muted-foreground">
          Give friends and testers full access at no charge.
        </p>
      </div>

      <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-5">
        <div className="space-y-1.5">
          <Label htmlFor="inv-count">How many codes</Label>
          <Input
            id="inv-count"
            type="number"
            min={1}
            max={50}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inv-uses">People per code</Label>
          <Input
            id="inv-uses"
            type="number"
            min={1}
            value={maxUses}
            onChange={(e) => setMaxUses(Number(e.target.value))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inv-until">Free access until (optional)</Label>
          <Input
            id="inv-until"
            type="date"
            value={accessUntil}
            onChange={(e) => setAccessUntil(e.target.value)}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-1">
          <Label htmlFor="inv-note">Note</Label>
          <Input
            id="inv-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. beta testers"
          />
        </div>
        <div className="flex items-end">
          <Button
            className="w-full"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            Create
          </Button>
        </div>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Used</TableHead>
              <TableHead>Free until</TableHead>
              <TableHead>Note</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(codes.data ?? []).map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-mono">{c.code}</TableCell>
                <TableCell>
                  {c.uses} / {c.max_uses}
                </TableCell>
                <TableCell>{c.access_until ? formatDate(c.access_until) : "No end"}</TableCell>
                <TableCell className="text-muted-foreground">{c.note ?? "—"}</TableCell>
                <TableCell>
                  {c.revoked ? (
                    <Badge variant="destructive">Revoked</Badge>
                  ) : c.uses >= c.max_uses ? (
                    <Badge variant="secondary">Fully used</Badge>
                  ) : (
                    <Badge>Active</Badge>
                  )}
                </TableCell>
                <TableCell className="space-x-1 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Copy code"
                    onClick={() => {
                      void navigator.clipboard.writeText(c.code);
                      toast.success("Code copied");
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => revokeMutation.mutate({ id: c.id, revoked: !c.revoked })}
                  >
                    {c.revoked ? "Restore" : "Revoke"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {(codes.data ?? []).length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                  No codes yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
