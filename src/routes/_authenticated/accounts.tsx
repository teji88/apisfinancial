import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  ACCOUNT_TYPES,
  OWNER_LABELS,
  formatCad,
  ownerLabel,
  summariseAccount,
} from "@/lib/finance";
import { useEntitlement } from "@/lib/entitlement";
import { UpgradeDialog } from "@/components/PlanUpgrade";
import { useAddAccount, useDeleteAccount, usePortfolio, useUpdateAccount } from "@/lib/portfolio";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/accounts")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "Accounts — Apis Financial" },
      {
        name: "description",
        content:
          "Manage your TFSA, RRSP, Spousal RRSP, LIRA, RESP, RDSP, FHSA, non-registered and corporate accounts in one place.",
      },
      { property: "og:title", content: "Accounts — Apis Financial" },
      {
        property: "og:description",
        content: "Every Canadian registered and taxable account type, tracked in CAD.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AccountsPage,
});

function AccountsPage() {
  const { accounts, holdings, transactions, quotes, fxUsdCad } = usePortfolio();
  const addAccount = useAddAccount();
  const updateAccount = useUpdateAccount();
  const deleteAccount = useDeleteAccount();
  const { entitlement, hasProPlus } = useEntitlement();

  const [accountType, setAccountType] = useState<string>("TFSA");
  const [accountName, setAccountName] = useState("");
  const [currency, setCurrency] = useState("CAD");
  const [institution, setInstitution] = useState("");
  const [trackCash, setTrackCash] = useState(false);
  const [ownerType, setOwnerType] = useState("self");
  const [memberName, setMemberName] = useState("");
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [familyReason, setFamilyReason] = useState<string | null>(null);

  const FAMILY_REASON =
    "Tracking a partner's or a child's accounts — including their RESP and RDSP — is part of Pro+ ($2 a month or $20 a year).";

  const accountLimit = entitlement.accountLimit;
  const atAccountLimit = accountLimit != null && accounts.length >= accountLimit;
  const holdingLimit = entitlement.holdingLimit;

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (atAccountLimit || entitlement.readOnly) {
      setUpgradeOpen(true);
      return;
    }
    if (ownerType !== "self" && !hasProPlus) {
      setFamilyReason(FAMILY_REASON);
      setUpgradeOpen(true);
      return;
    }
    try {
      await addAccount.mutateAsync({
        accountType,
        accountName,
        currency,
        institution,
        trackCash,
        ownerType,
        memberName,
      });
      toast.success(`${accountName} added`);
      setAccountName("");
      setInstitution("");
      setMemberName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add the account");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Accounts</h1>
        <p className="text-sm text-muted-foreground">
          Registered and taxable accounts. Balances are converted to CAD.
        </p>
      </div>

      <UpgradeDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        reason={
          familyReason ??
          "Accounts, holdings and family tracking are all free — no subscription needed."
        }
      />


      <form onSubmit={handleAdd} className="panel grid gap-4 p-5 md:grid-cols-5">
        <div className="space-y-1.5">
          <Label>Account type</Label>
          <Select value={accountType} onValueChange={setAccountType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACCOUNT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="name">Nickname</Label>
          <Input
            id="name"
            required
            placeholder="My TFSA"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Currency</Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="CAD">CAD</SelectItem>
              <SelectItem value="USD">USD</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inst">Institution</Label>
          <Input
            id="inst"
            placeholder="Questrade"
            value={institution}
            onChange={(e) => setInstitution(e.target.value)}
          />
        </div>
        <div className="flex items-end">
          <Button type="submit" className="w-full" disabled={addAccount.isPending}>
            Add account
          </Button>
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label>Whose account is this?</Label>
          <Select
            value={ownerType}
            onValueChange={(v) => {
              if (v !== "self" && !hasProPlus) {
                setFamilyReason(FAMILY_REASON);
                setUpgradeOpen(true);
                return;
              }
              setOwnerType(v);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="self">{OWNER_LABELS["self"]}</SelectItem>
              <SelectItem value="partner">
                {OWNER_LABELS["partner"]}
                {hasProPlus ? "" : " (Pro+)"}
              </SelectItem>
              <SelectItem value="child">
                {OWNER_LABELS["child"]}
                {hasProPlus ? "" : " (Pro+)"}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        {ownerType !== "self" && (
          <div className="space-y-1.5 md:col-span-3">
            <Label htmlFor="member">Family member name</Label>
            <Input
              id="member"
              placeholder={ownerType === "child" ? "Tejas" : "Partner's first name"}
              value={memberName}
              onChange={(e) => setMemberName(e.target.value)}
            />
          </div>
        )}
        <div className="flex items-start gap-3 md:col-span-5">
          <Switch id="track-cash" checked={trackCash} onCheckedChange={setTrackCash} />
          <div className="space-y-0.5">
            <Label htmlFor="track-cash">Keep a cash balance in this account</Label>
            <p className="text-xs text-muted-foreground">
              Off by default: a purchase is treated as money you brought in, so the account is worth
              what you hold. Turn it on only if you record deposits first and then buy.
            </p>
          </div>
        </div>
      </form>

      <div className="panel overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Institution</TableHead>
              <TableHead className="text-center">Cash balance</TableHead>
              <TableHead className="text-right">Total value</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {accounts.map((a) => {
              const s = summariseAccount(
                a,
                transactions.filter((t) => t.account_id === a.id),
                holdings.filter((h) => h.account_id === a.id),
                quotes,
                fxUsdCad,
              );
              return (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">
                    {a.account_name}
                    {(a.owner_type ?? "self") !== "self" && (
                      <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                        {ownerLabel(a)}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {a.account_type} · {a.currency}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{a.institution ?? "—"}</TableCell>
                  <TableCell className="text-center">
                    <Switch
                      aria-label={`Keep a cash balance in ${a.account_name}`}
                      checked={a.track_cash ?? false}
                      onCheckedChange={(checked) =>
                        updateAccount.mutate({ id: a.id, trackCash: checked })
                      }
                    />
                  </TableCell>
                  <TableCell className="num text-right">{formatCad(s.totalValue)}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete account"
                      onClick={() => {
                        if (
                          confirm(
                            `Delete ${a.account_name}? All its holdings and transactions are removed too.`,
                          )
                        ) {
                          deleteAccount.mutate(a.id);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {accounts.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  No accounts yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
