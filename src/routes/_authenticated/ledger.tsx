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
import { useEntitlement } from "@/lib/entitlement";
import { UpgradeDialog } from "@/components/PlanUpgrade";
import { lookupSymbol } from "@/lib/market.functions";
import { getFxRateOn, getQuoteOnDate } from "@/lib/history.functions";
import {
  TICKER_HINT,
  canadianAlternative,
  normalizeTicker,
  suggestTickers,
} from "@/lib/ticker-universe";

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
      { title: "Ledger — Apis Financial" },
      {
        name: "description",
        content:
          "Record buys, sells, dividends, DRIPs, deposits, withdrawals and fees in CAD or USD with exact FX rates.",
      },
      { property: "og:title", content: "Ledger — Apis Financial" },
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
  const { entitlement } = useEntitlement();
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const addTransaction = useAddTransaction();

  const deleteTransaction = useDeleteTransaction();
  const lookup = useServerFn(lookupSymbol);
  const fxOnDate = useServerFn(getFxRateOn);
  const quoteOnDate = useServerFn(getQuoteOnDate);

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
  // Once the user types their own rate or price, we never overwrite it.
  const [fxTouched, setFxTouched] = useState(false);
  // Once the user types their own price, it wins over any fetched close.
  const [priceTouched, setPriceTouched] = useState(false);
  const [priceNote, setPriceNote] = useState<string | null>(null);
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
    if (fxTouched) return;
    if (currency !== "USD") {
      setFxRate("1");
      setFxAuto(false);
      return;
    }
    // A partially typed date ("2026-0") would fail server validation.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
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

  const symbolSuggestions = useMemo(() => suggestTickers(symbol, 8), [symbol]);

  // When a past trade date is chosen (or changed), fill the price with that
  // day's close — unless the user typed their own price.
  useEffect(() => {
    let cancelled = false;
    if (priceTouched) return;
    const clean = normalizeTicker(symbol);
    if (!clean || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= today()) return;
    void (async () => {
      const res = await quoteOnDate({ data: { symbol: clean, date } });
      if (cancelled || !res) return;
      setPrice(res.close.toFixed(2));
      setPriceNote(`Close on ${res.date}`);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

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
      const first = normalizeTicker(symbol);
      let used = first;
      let quote = await lookup({ data: { symbol: first } });
      // A bare symbol that is also a TSX listing: try the Canadian spelling.
      if (!quote?.price) {
        const alt = canadianAlternative(first);
        if (alt) {
          const second = await lookup({ data: { symbol: alt } });
          if (second?.price) {
            quote = second;
            used = alt;
          }
        }
      }
      if (!quote?.price) {
        toast.error(`No price found for ${first}. ${TICKER_HINT}`);
        return;
      }
      setSymbol(used);
      setSymbolName(quote.name ?? null);
      if (quote.currency) {
        setCurrency(quote.currency);
        if (!fxTouched) setFxRate(quote.currency === "USD" ? fxUsdCad.toFixed(4) : "1");
      }
      const market = used.endsWith(".TO") ? "Toronto" : "US";

      // Use the close on the trade date rather than today's quote.
      const wantsHistory = /^\d{4}-\d{2}-\d{2}$/.test(date) && date < today();
      const onDate = wantsHistory ? await quoteOnDate({ data: { symbol: used, date } }) : null;
      if (onDate) {
        setPrice(onDate.close.toFixed(2));
        setPriceNote(`Close on ${onDate.date}`);
        toast.success(
          `${quote.name ?? used} · ${market} · ${onDate.close.toFixed(2)} ${onDate.currency} (close on ${onDate.date})`,
        );
        return;
      }
      setPrice(quote.price.toFixed(2));
      setPriceNote(wantsHistory ? "No close stored for that date — today's price shown" : null);
      toast.success(
        `${quote.name ?? used} · ${market} · ${quote.price.toFixed(2)} ${quote.currency ?? ""}`,
      );
    } finally {
      setLooking(false);
    }
  }

  /** Re-fetch the official close for the date currently in the form. */
  async function pullPriceOnDate() {
    const clean = normalizeTicker(symbol);
    if (!clean) {
      toast.error("Enter a symbol first.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      toast.error("Pick a valid date first.");
      return;
    }
    setPricing(true);
    try {
      const res = await quoteOnDate({ data: { symbol: clean, date } });
      if (!res) {
        toast.error(`No close stored for ${clean} on ${date}.`);
        return;
      }
      setPrice(res.close.toFixed(2));
      setPriceNote(`Close on ${res.date}`);
      toast.success(`${clean} closed at ${res.close.toFixed(2)} ${res.currency} on ${res.date}`);
    } finally {
      setPricing(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const targetAccount = accountId || accounts[0]?.id;
    if (!targetAccount) {
      toast.error("Add an account first.");
      return;
    }
    const cleanSymbol = normalizeTicker(symbol);
    const wouldAddHolding =
      !isCash &&
      cleanSymbol !== "" &&
      !holdings.some((h) => h.account_id === targetAccount && h.symbol === cleanSymbol);
    if (
      entitlement.readOnly ||
      (wouldAddHolding &&
        entitlement.holdingLimit != null &&
        holdings.length >= entitlement.holdingLimit)
    ) {
      setUpgradeOpen(true);
      return;
    }
    try {

      await addTransaction.mutateAsync({
        accountId: targetAccount,
        symbol: isCash ? "" : cleanSymbol,
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

      {entitlement.holdingLimit != null && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
          <span>
            Free plan: {holdings.length} of {entitlement.holdingLimit} holdings used.
          </span>
          <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setUpgradeOpen(true)}>
            Upgrade to Pro
          </Button>
        </div>
      )}

      <UpgradeDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        reason={
          entitlement.readOnly
            ? "Your plan has ended, so Apis Financial is view-only. Restart Pro to make changes."
            : "The free plan includes ten holdings. Pro removes the limit."
        }
      />



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
                  placeholder="XEQT.TO or AAPL"
                  list="ticker-suggestions"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                  onBlur={() => setSymbol((s) => normalizeTicker(s))}
                />
                <datalist id="ticker-suggestions">
                  {symbolSuggestions.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
                <Button type="button" variant="outline" size="icon" onClick={handleLookup}>
                  {looking ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                </Button>
              </div>
              {symbolName ? (
                <p className="text-xs text-muted-foreground">{symbolName}</p>
              ) : (
                <p className="text-xs text-muted-foreground">{TICKER_HINT}</p>
              )}
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
                  <div className="flex gap-2">
                    <Input
                      id="price"
                      type="number"
                      step="any"
                      value={price}
                      onChange={(e) => {
                        setPrice(e.target.value);
                        setPriceNote("Your own price");
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void pullPriceOnDate()}
                      disabled={pricing}
                    >
                      {pricing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Close on date"}
                    </Button>
                  </div>
                  {priceNote ? (
                    <p className="text-xs text-muted-foreground">{priceNote}</p>
                  ) : null}
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
                setFxTouched(true);
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
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Edit transaction"
                          onClick={() => setEditing(t)}
                        >
                          <Pencil className="h-4 w-4 text-muted-foreground" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Delete transaction"
                          onClick={() => deleteTransaction.mutate(t.id)}
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
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

      {editing ? (
        <EditTransactionDialog
          transaction={editing}
          accounts={accounts}
          holdings={holdings}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function EditTransactionDialog({
  transaction,
  accounts,
  holdings,
  onClose,
}: {
  transaction: Transaction;
  accounts: Account[];
  holdings: Holding[];
  onClose: () => void;
}) {
  const updateTransaction = useUpdateTransaction();
  const fxOnDate = useServerFn(getFxRateOn);
  const quoteOnDate = useServerFn(getQuoteOnDate);
  const holding = holdings.find((h) => h.id === transaction.holding_id);

  const [accountId, setAccountId] = useState(transaction.account_id);
  const [type, setType] = useState(transaction.transaction_type);
  const [symbol, setSymbol] = useState(holding?.symbol ?? "");
  const [date, setDate] = useState(transaction.transaction_date);
  const [units, setUnits] = useState(String(transaction.units ?? 0));
  const [price, setPrice] = useState(String(transaction.price_per_unit ?? 0));
  const [amount, setAmount] = useState(transaction.amount == null ? "" : String(transaction.amount));
  const [currency, setCurrency] = useState(transaction.currency);
  const [fxRate, setFxRate] = useState(String(transaction.fx_rate ?? 1));
  const [fee, setFee] = useState(String(transaction.fee ?? 0));

  const isCash = CASH_TYPES.includes(type);

  async function pullRate() {
    if (currency !== "USD") {
      setFxRate("1");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      toast.error("Pick a valid date first.");
      return;
    }
    const res = await fxOnDate({ data: { date } });
    if (res.rate) setFxRate(res.rate.toFixed(4));
    else toast.error("No published rate for that date.");
  }

  async function pullPrice() {
    const clean = symbol.trim().toUpperCase();
    if (!clean) {
      toast.error("Enter a symbol first.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      toast.error("Pick a valid date first.");
      return;
    }
    const res = await quoteOnDate({ data: { symbol: clean, date } });
    if (!res) {
      toast.error(`No close stored for ${clean} on ${date}.`);
      return;
    }
    setPrice(res.close.toFixed(2));
    toast.success(`${clean} closed at ${res.close.toFixed(2)} ${res.currency} on ${res.date}`);
  }

  async function save() {
    try {
      await updateTransaction.mutateAsync({
        id: transaction.id,
        accountId,
        symbol: isCash ? "" : symbol,
        name: holding?.name ?? null,
        assetType: holding?.asset_type ?? "Stock",
        transactionType: type,
        units: isCash ? 0 : Number(units || 0),
        pricePerUnit: isCash ? 0 : Number(price || 0),
        amount:
          isCash || type === "DIVIDEND" ? Number(amount || 0) || null : null,
        currency,
        fxRate: Number(fxRate || 1),
        fee: Number(fee || 0),
        date,
      });
      toast.success("Transaction updated");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the change");
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit transaction</DialogTitle>
          <DialogDescription>
            Correcting a figure here updates your ACB, returns and retirement plan straight away.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Account</Label>
            <Select value={accountId} onValueChange={setAccountId}>
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
            <Label htmlFor="edit-date">Date</Label>
            <Input
              id="edit-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
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
          {!isCash ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="edit-symbol">Symbol</Label>
                <Input
                  id="edit-symbol"
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-units">Units</Label>
                <Input
                  id="edit-units"
                  type="number"
                  step="any"
                  value={units}
                  onChange={(e) => setUnits(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-price">Price per unit</Label>
                <div className="flex gap-2">
                  <Input
                    id="edit-price"
                    type="number"
                    step="any"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                  <Button type="button" variant="outline" onClick={() => void pullPrice()}>
                    Close on date
                  </Button>
                </div>
              </div>
            </>
          ) : null}
          {isCash || type === "DIVIDEND" ? (
            <div className="space-y-1.5">
              <Label htmlFor="edit-amount">Amount</Label>
              <Input
                id="edit-amount"
                type="number"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="edit-fx">FX rate to CAD</Label>
            <div className="flex gap-2">
              <Input
                id="edit-fx"
                type="number"
                step="any"
                value={fxRate}
                onChange={(e) => setFxRate(e.target.value)}
              />
              <Button type="button" variant="outline" onClick={() => void pullRate()}>
                Use rate on date
              </Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-fee">Commission / fee</Label>
            <Input
              id="edit-fee"
              type="number"
              step="any"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={updateTransaction.isPending}>
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
