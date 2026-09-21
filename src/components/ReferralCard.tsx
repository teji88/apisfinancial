import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Copy, Gift } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getReferralInfo } from "@/lib/referral.functions";
import { formatDate } from "@/lib/entitlement";

export function ReferralCard() {
  const fetchInfo = useServerFn(getReferralInfo);
  const { data } = useQuery({
    queryKey: ["referral-info"],
    staleTime: 60 * 1000,
    queryFn: async () => fetchInfo({ data: undefined as never }),
  });
  const [copied, setCopied] = useState(false);

  const origin = typeof window === "undefined" ? "https://apisfinancial.app" : window.location.origin;
  const link = data?.code ? `${origin}/auth?ref=${data.code}` : "";

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Invite link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy — select the link and copy it manually.");
    }
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-3">
        <Gift className="h-5 w-5 text-primary" />
        <p className="font-medium">Invite a friend, get a free year</p>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Share your link. When someone who joins through it takes a yearly plan ($10 or $20), you
        get a full year of that same plan free. Every friend adds another year.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Input readOnly value={link} className="min-w-[14rem] flex-1 font-mono text-xs" />
        <Button variant="outline" size="sm" onClick={() => void copy()} disabled={!link}>
          {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
          Copy link
        </Button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
        <div>
          <p className="num text-xl font-semibold">{data?.signups ?? 0}</p>
          <p className="text-xs text-muted-foreground">Friends joined</p>
        </div>
        <div>
          <p className="num text-xl font-semibold">{data?.rewards.length ?? 0}</p>
          <p className="text-xs text-muted-foreground">Free years earned</p>
        </div>
        <div>
          <p className="num text-xl font-semibold">{formatDate(data?.freeUntil ?? null)}</p>
          <p className="text-xs text-muted-foreground">Free access until</p>
        </div>
      </div>
    </div>
  );
}
