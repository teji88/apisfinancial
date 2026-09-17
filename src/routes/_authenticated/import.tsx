import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  FileUp,
  Loader2,
  PencilLine,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { parseStatement, type ParsedTransaction } from "@/lib/import.functions";
import { getFxRateOn } from "@/lib/history.functions";
import { useAccounts, useAddTransaction } from "@/lib/portfolio";
import { ACCOUNT_TYPES, TRANSACTION_TYPES } from "@/lib/finance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export const Route = createFileRoute("/_authenticated/import")({
  component: ImportPage,
  head: () => ({
    meta: [
      { title: "Import statements — MapleWealth" },
      {
        name: "description",
        content:
          "Drop a brokerage statement, CSV or screenshot and let AI turn it into ledger transactions you review before saving.",
      },
      { property: "og:title", content: "Import statements — MapleWealth" },
      {
        property: "og:description",
        content: "AI reads your Canadian brokerage statements and drafts ledger entries for review.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

type Row = ParsedTransaction & { rowId: string; accountId: string };

const ACCEPT = ".csv,.txt,.pdf,.png,.jpg,.jpeg";

function readFile(file: File): Promise<{ dataUrl: string | null; text: string | null }> {
  const isText =
    file.type.startsWith("text/") ||
    file.name.toLowerCase().endsWith(".csv") ||
    file.name.toLowerCase().endsWith(".txt");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () =>
      resolve(
        isText
          ? { dataUrl: null, text: String(reader.result ?? "") }
          : { dataUrl: String(reader.result ?? ""), text: null },
      );
    if (isText) reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
}

function ImportPage() {
  const accounts = useAccounts();
  const addTransaction = useAddTransaction();
  const parse = useServerFn(parseStatement);
  const fxOnDate = useServerFn(getFxRateOn);
  const inputRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [broker, setBroker] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);

  const accountList = accounts.data ?? [];

  function matchAccount(parsed: ParsedTransaction): string {
    const byType = accountList.find(
      (a) => a.account_type.toLowerCase() === parsed.account_type.toLowerCase(),
    );
    return byType?.id ?? accountList[0]?.id ?? "";
  }

  /** Blank row so a transaction can be typed in without a file. */
  function addManualRow() {
    const first = accountList[0];
    setRows((prev) => [
      ...prev,
      {
        account_type: first?.account_type ?? "Non-Registered",
        account_hint: null,
        date: new Date().toISOString().slice(0, 10),
        type: "BUY",
        symbol: "",
        name: null,
        quantity: 0,
        price: 0,
        amount: null,
        currency: first?.currency ?? "CAD",
        fee: 0,
        confidence: 1,
        note: "Entered by hand",
        rowId: `manual-${Date.now()}-${prev.length}`,
        accountId: first?.id ?? "",
      },
    ]);
  }

  async function handleFile(file: File) {
    if (file.size > 20 * 1024 * 1024) {
      toast.error("That file is larger than 20 MB.");
      return;
    }
    setBusy(true);
    try {
      const { dataUrl, text } = await readFile(file);
      const result = await parse({
        data: {
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          dataUrl,
          text,
        },
      });
      setBroker(result.broker);
      setRows(
        result.transactions.map((t, i) => ({
          ...t,
          rowId: `${Date.now()}-${i}`,
          accountId: matchAccount(t),
        })),
      );
      if (result.transactions.length === 0) {
        toast.warning("No transactions found in that file.");
      } else {
        toast.success(`Found ${result.transactions.length} transactions — review them below.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  function update(rowId: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)));
  }

  async function commit() {
    if (rows.length === 0) return;
    const missing = rows.filter((r) => !r.accountId);
    if (missing.length > 0) {
      toast.error("Pick an account for every row first.");
      return;
    }
    setSaving(true);
    let saved = 0;
    const rateCache = new Map<string, number>();
    const rateFor = async (currency: string, date: string): Promise<number> => {
      if (currency !== "USD") return 1;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 1;
      const cached = rateCache.get(date);
      if (cached) return cached;
      const res = await fxOnDate({ data: { date } });
      const rate = res.rate ?? 1;
      rateCache.set(date, rate);
      return rate;
    };
    try {
      for (const row of rows) {
        const units = row.quantity ?? 0;
        const price = row.price ?? 0;
        const cashAmount = row.amount ?? 0;
        await addTransaction.mutateAsync({
          accountId: row.accountId,
          symbol: row.symbol ?? "",
          name: row.name,
          assetType: "Stock",
          transactionType: row.type,
          units,
          pricePerUnit: price,
          amount: ["DIVIDEND", "DEPOSIT", "WITHDRAWAL", "FEE"].includes(row.type)
            ? cashAmount
            : null,
          currency: row.currency,
          fxRate: await rateFor(row.currency, row.date),
          fee: row.fee ?? 0,
          date: row.date,
        });
        saved += 1;
      }
      toast.success(`${saved} transactions added to your ledger.`);
      setRows([]);
      setBroker(null);
    } catch (error) {
      toast.error(
        `Saved ${saved} of ${rows.length}. ${error instanceof Error ? error.message : ""}`,
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Import statements</h1>
        <p className="text-sm text-muted-foreground">
          Drop a brokerage statement, trade confirmation, CSV export or screenshot. Everything is
          reviewed by you before it reaches the ledger.
        </p>
      </div>

      {accountList.length === 0 ? (
        <div className="panel flex items-center gap-3 p-4 text-sm">
          <AlertTriangle className="h-4 w-4 text-loss" />
          Add an account first — imported transactions need somewhere to go.
        </div>
      ) : null}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) void handleFile(file);
        }}
        className={`panel flex flex-col items-center justify-center gap-3 border-2 border-dashed p-10 text-center transition-colors ${
          dragging ? "border-primary bg-primary/5" : "border-border"
        }`}
      >
        {busy ? (
          <>
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
            <p className="text-sm font-medium">Reading your statement…</p>
            <p className="text-xs text-muted-foreground">
              This can take up to a minute for long PDFs.
            </p>
          </>
        ) : (
          <>
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <FileUp className="h-5 w-5" />
            </span>
            <p className="text-sm font-medium">Drag a file here</p>
            <p className="text-xs text-muted-foreground">CSV, PDF, PNG or JPEG · up to 20 MB</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
                <Sparkles className="mr-1.5 h-4 w-4" />
                Choose a file
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={accountList.length === 0}
                onClick={addManualRow}
              >
                <PencilLine className="mr-1.5 h-4 w-4" />
                Enter one by hand
              </Button>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = "";
              }}
            />
          </>
        )}
      </div>

      {rows.length > 0 ? (
        <div className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Review {rows.length} transactions
              </h2>
              {broker ? (
                <p className="text-xs text-muted-foreground">Detected: {broker}</p>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setRows([]);
                  setBroker(null);
                }}
              >
                Discard
              </Button>
              <Button size="sm" onClick={() => void commit()} disabled={saving}>
                {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                Approve &amp; add to ledger
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Check</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Fee</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const low = row.confidence < 0.8;
                  return (
                    <TableRow key={row.rowId} className={low ? "bg-primary/5" : undefined}>
                      <TableCell className="whitespace-nowrap">
                        {low ? (
                          <span
                            className="flex items-center gap-1 text-xs text-loss"
                            title={row.note ?? "Please double-check this row"}
                          >
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {Math.round(row.confidence * 100)}%
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-gain">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {Math.round(row.confidence * 100)}%
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="min-w-44">
                        <Select
                          value={row.accountId}
                          onValueChange={(v) => update(row.rowId, { accountId: v })}
                        >
                          <SelectTrigger className="h-8">
                            <SelectValue placeholder="Pick account" />
                          </SelectTrigger>
                          <SelectContent>
                            {accountList.map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                {a.account_name} · {a.account_type}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Statement said: {row.account_type}
                          {row.account_hint ? ` · ${row.account_hint}` : ""}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="date"
                          className="h-8 w-36"
                          value={row.date}
                          onChange={(e) => update(row.rowId, { date: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={row.type}
                          onValueChange={(v) => update(row.rowId, { type: v })}
                        >
                          <SelectTrigger className="h-8 w-32">
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
                      </TableCell>
                      <TableCell>
                        <Input
                          className="h-8 w-28 uppercase"
                          value={row.symbol ?? ""}
                          onChange={(e) =>
                            update(row.rowId, { symbol: e.target.value.toUpperCase() })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="num h-8 w-24 text-right"
                          value={row.quantity ?? ""}
                          onChange={(e) =>
                            update(row.rowId, { quantity: Number(e.target.value) || 0 })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="num h-8 w-24 text-right"
                          value={row.price ?? ""}
                          onChange={(e) => update(row.rowId, { price: Number(e.target.value) || 0 })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="num h-8 w-24 text-right"
                          value={row.amount ?? ""}
                          onChange={(e) =>
                            update(row.rowId, { amount: Number(e.target.value) || 0 })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="num h-8 w-20 text-right"
                          value={row.fee ?? 0}
                          onChange={(e) => update(row.rowId, { fee: Number(e.target.value) || 0 })}
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={row.currency}
                          onValueChange={(v) => update(row.rowId, { currency: v })}
                        >
                          <SelectTrigger className="h-8 w-24">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="CAD">CAD</SelectItem>
                            <SelectItem value="USD">USD</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Remove row"
                          onClick={() =>
                            setRows((prev) => prev.filter((r) => r.rowId !== row.rowId))
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <p className="border-t px-5 py-3 text-xs text-muted-foreground">
            Rows highlighted in red were uncertain — check the date, amount and account before
            approving. Account types recognised: {ACCOUNT_TYPES.join(", ")}.
          </p>
        </div>
      ) : null}
    </div>
  );
}
