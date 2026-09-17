import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  TRANSACTION_TYPES,
  formatCad,
  formatUnits,
  type Account,
  type Holding,
  type Transaction,
} from "@/lib/finance";
import {
  useAddTransaction,
  useDeleteTransaction,
  useUpdateTransaction,
  usePortfolio,
} from "@/lib/portfolio";
import { lookupSymbol } from "@/lib/market.functions";
import { getFxRateOn } from "@/lib/history.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

export const Route = createFileRoute("/_authenticated/ledger")({
  head: () => ({
    meta: [
      { title: "Ledger — MapleWealth" },
      {
        name: "description",
        content:
          "Record buys, sells, dividends, DRIPs, deposits, withdrawals and fees in CAD or USD with exact FX rates.",
      },
      { property: "og:title", content: "Ledger — MapleWealth" },
      {
        property: "og:description",
        content: "A complete Canadian transaction ledger feeding your ACB and return calculations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LedgerPage,
});

const CASH_TYPES = ["DEPOSIT", "WITHDRAWAL", "FEE"];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function LedgerPage() {
  const { accounts, holdings, transactions, fxUsdCad } = usePortfolio();
  const addTransaction = useAddTransaction();
  const deleteTransaction = useDeleteTransaction();
  const lookup = useServerFn(lookupSymbol);
  const fxOnDate = useServerFn(getFxRateOn);

  const [accountId, setAccountId] = useState<string>("");
  const [type, setType] = useState<string>("BUY");
  const [symbol, setSymbol] = useState("");
  const [symbolName, setSymbolName] = useState<string | null>(null);
  const [assetType, setAssetType] = useState("Stock");
  const [units, setUnits] = useState("");
  const [price, setPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("CAD");
  const [fxRate, setFxRate] = useState("1");
  const [fxAuto, setFxAuto] = useState(false);
  const [fee, setFee] = useState("0");
  const [date, setDate] = useState(today());
  const [looking, setLooking] = useState(false);
  const [filterAccount, setFilterAccount] = useState<string>("all");
  const [editing, setEditing] = useState<Transaction | null>(null);

  const isCash = CASH_TYPES.includes(type);
  const selectedAccount = accounts.find((a) => a.id === accountId) ?? accounts[0];

  // Historical USD→CAD rate for the chosen trade date.
  useEffect(() => {
    let cancelled = false;
    if (currency !== "USD") {
      setFxRate("1");
      setFxAuto(false);
      return;
    }
    void (async () => {
      const res = await fxOnDate({ data: { date } });
      if (cancelled) return;
      if (res.rate) {
        setFxRate(res.rate.toFixed(4));
        setFxAuto(true);
      } else {
        setFxRate(fxUsdCad.toFixed(4));
        setFxAuto(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency, date]);

  const rows = useMemo(() => {
    const list =
      filterAccount === "all"
        ? transactions
        : transactions.filter((t) => t.account_id === filterAccount);
    return list.slice(0, 300);
  }, [transactions, filterAccount]);

  async function handleLookup() {
    if (!symbol.trim()) return;
    setLooking(true);
    try {
      const quote = await lookup({ data: { symbol } });
      if (!quote?.price) {
        toast.error("No quote found for that symbol. Check the suffix, e.g. XEQT.TO");
        return;
      }
      setSymbolName(quote.name ?? null);
      setPrice(quote.price.toFixed(2));
      if (quote.currency) {
        setCurrency(quote.currency);
        setFxRate(quote.currency === "USD" ? fxUsdCad.toFixed(4) : "1");
      }
      toast.success(`${quote.name ?? symbol.toUpperCase()} · ${quote.price.toFixed(2)} ${quote.currency ?? ""}`);
    } finally {
      setLooking(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const targetAccount = accountId || accounts[0]?.id;
    if (!targetAccount) {
      toast.error("Add an account first.");
      return;
    }
    try {
      await addTransaction.mutateAsync({
        accountId: targetAccount,
        symbol: isCash ? "" : symbol,
        name: symbolName,
        assetType,
        transactionType: type,
        units: isCash ? 0 : Number(units || 0),
        pricePerUnit: isCash ? 0 : Number(price || 0),
        amount: isCash || type === "DIVIDEND" ? Number(amount || 0) || null : null,
        currency,
        fxRate: Number(fxRate || 1),
        fee: Number(fee || 0),
        date,
      });
      toast.success("Transaction recorded");
      setUnits("");
      setAmount("");
      setFee("0");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the transaction");
    }
  }

  if (accounts.length === 0) {
    return (
      <div className="panel p-10 text-center">
        <h2 className="text-lg font-semibold">No accounts yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Create an account before recording transactions.
        </p>
        <Button asChild className="mt-4">
          <Link to="/accounts">Add an account</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Ledger</h1>
        <p className="text-sm text-muted-foreground">
          Every transaction is stored in its original currency and converted to CAD with the FX rate
          you record.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="panel space-y-4 p-5">
        <div className="grid gap-4 md:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Account</Label>
            <Select value={accountId || accounts[0]!.id} onValueChange={setAccountId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.account_type} · {a.account_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSACTION_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="date">Date</Label>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Currency</Label>
            <Select
              value={currency}
              onValueChange={(v) => {
                setCurrency(v);
                setFxRate(v === "USD" ? fxUsdCad.toFixed(4) : "1");
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CAD">CAD</SelectItem>
                <SelectItem value="USD">USD</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {!isCash && (
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="symbol">Symbol</Label>
              <div className="flex gap-2">
                <Input
                  id="symbol"
                  placeholder="XEQT.TO"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                />
                <Button type="button" variant="outline" size="icon" onClick={handleLookup}>
                  {looking ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                </Button>
              </div>
              {symbolName && <p className="text-xs text-muted-foreground">{symbolName}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Asset type</Label>
              <Select value={assetType} onValueChange={setAssetType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Stock">Stock</SelectItem>
                  <SelectItem value="ETF">ETF</SelectItem>
                  <SelectItem value="Cash">Cash</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {type === "DIVIDEND" ? (
              <div className="space-y-1.5">
                <Label htmlFor="amount">Dividend amount</Label>
                <Input
                  id="amount"
                  type="number"
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="units">Units</Label>
                  <Input
                    id="units"
                    type="number"
                    step="any"
                    value={units}
                    onChange={(e) => setUnits(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="price">Price per unit</Label>
                  <Input
                    id="price"
                    type="number"
                    step="any"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                </div>
              </>
            )}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-4">
          {isCash && (
            <div className="space-y-1.5">
              <Label htmlFor="cash-amount">Amount</Label>
              <Input
                id="cash-amount"
                type="number"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="fx">FX rate to CAD</Label>
            <Input
              id="fx"
              type="number"
              step="any"
              value={fxRate}
              onChange={(e) => {
                setFxRate(e.target.value);
                setFxAuto(false);
              }}
            />
            {fxAuto ? (
              <p className="text-xs text-muted-foreground">Bank rate on {date}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fee">Commission / fee</Label>
            <Input
              id="fee"
              type="number"
              step="any"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />
          </div>
          <div className="flex items-end md:col-start-4">
            <Button type="submit" className="w-full" disabled={addTransaction.isPending}>
              Record transaction
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Recording into {selectedAccount?.account_type} · {selectedAccount?.account_name}. USD
          trades use the FX rate above (today: {fxUsdCad.toFixed(4)}).
        </p>
      </form>

      <div className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Transactions
          </h2>
          <Select value={filterAccount} onValueChange={setFilterAccount}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.account_type} · {a.account_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">CAD value</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => {
                const account = accounts.find((a) => a.id === t.account_id);
                const holding = holdings.find((h) => h.id === t.holding_id);
                const cad =
                  (t.amount != null && t.amount !== 0
                    ? t.amount
                    : t.units * t.price_per_unit) * t.fx_rate;
                return (
                  <TableRow key={t.id}>
                    <TableCell className="num">{t.transaction_date}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {account?.account_type} · {account?.account_name}
                    </TableCell>
                    <TableCell>
                      <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium">
                        {t.transaction_type}
                      </span>
                    </TableCell>
                    <TableCell>{holding?.symbol ?? "—"}</TableCell>
                    <TableCell className="num text-right">
                      {t.units ? formatUnits(t.units) : "—"}
                    </TableCell>
                    <TableCell className="num text-right">
                      {t.price_per_unit ? t.price_per_unit.toFixed(2) : "—"}
                    </TableCell>
                    <TableCell className="num text-right">{formatCad(cad)}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Delete transaction"
                        onClick={() => deleteTransaction.mutate(t.id)}
                      >
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                    No transactions yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
