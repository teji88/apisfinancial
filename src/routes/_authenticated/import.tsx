import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  FileUp,
  Loader2,
  Lock,
  PencilLine,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { parseStatement, type ParsedTransaction } from "@/lib/import.functions";
import { parseCsvText, type CsvPortfolio } from "@/lib/csv-import";
import { classifyFile } from "@/lib/file-kind";
import { getFxRateOn } from "@/lib/history.functions";
import { learnCsvMapping } from "@/lib/csv-learn.functions";
import {
  buildLearnedProfile,
  deleteLearnedProfile,
  loadLearnedProfiles,
  saveLearnedProfile,
  type LearnedColumnField,
  type LearnedProfile,
} from "@/lib/csv-learn";
import { findDuplicateRows } from "@/lib/duplicate-check";
import { useAccounts, useHoldings, useAddTransaction, createAccount, useTransactions } from "@/lib/portfolio";
import { useEntitlement } from "@/lib/entitlement";
import { UpgradeDialog } from "@/components/PlanUpgrade";
import { ACCOUNT_TYPES, OWNER_LABELS, TRANSACTION_TYPES } from "@/lib/finance";
import { Label } from "@/components/ui/label";

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
  staticData: { sitemap: false },
  component: ImportPage,
  head: () => ({
    meta: [
      { title: "Import statements — Apis Financial" },
      {
        name: "description",
        content:
          "Drop a brokerage statement, CSV or screenshot and let AI turn it into ledger transactions you review before saving.",
      },
      { property: "og:title", content: "Import statements — Apis Financial" },
      {
        property: "og:description",
        content:
          "AI reads your Canadian brokerage statements and drafts ledger entries for review.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

type Row = ParsedTransaction & {
  rowId: string;
  accountId: string;
  /** Portfolio label from the file, used for the mapping step. */
  portfolio?: string;
  /** Trade-date exchange rate already present in the file. */
  fx?: number;
};

/** How each portfolio found in a file should land in Apis Financial. */
type Mapping = {
  /** An existing account id, or "new" to create one. */
  target: string;
  accountType: string;
  currency: string;
  ownerType: string;
  memberName: string;
};

const ACCEPT = ".csv,.txt,.pdf,.png,.jpg,.jpeg";
const PAGE_SIZE = 50;
const SAVE_BATCH = 250;

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsText(file);
  });
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

/** First bytes of the file — enough for content-based classification. */
async function readHeaderBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, 8192).arrayBuffer());
}

function ImportPage() {
  const accounts = useAccounts();
  const holdingsQuery = useHoldings();
  const transactionsQuery = useTransactions();
  const { entitlement } = useEntitlement();
  const addTransaction = useAddTransaction();
  const fxOnDate = useServerFn(getFxRateOn);
  const parseStatementFn = useServerFn(parseStatement);
  const learnMappingFn = useServerFn(learnCsvMapping);
  const inputRef = useRef<HTMLInputElement>(null);

  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [broker, setBroker] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [page, setPage] = useState(0);
  const [portfolios, setPortfolios] = useState<CsvPortfolio[]>([]);
  const [mapping, setMapping] = useState<Record<string, Mapping>>({});
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const holdings = holdingsQuery.data ?? [];
  const ledgerTransactions = transactionsQuery.data ?? [];
  const isPro = entitlement.tier !== "free";
  const [upgradeReason, setUpgradeReason] = useState<string | null>(null);
  // AI-learned CSV layouts, persisted on this device.
  const [learnedProfiles, setLearnedProfiles] = useState<LearnedProfile[]>([]);
  // A CSV the deterministic parser could not read, awaiting AI mapping.
  const [learnCandidate, setLearnCandidate] = useState<{ fileName: string; text: string } | null>(null);
  const [learning, setLearning] = useState(false);

  useEffect(() => {
    setLearnedProfiles(loadLearnedProfiles());
  }, []);

  const accountList = accounts.data ?? [];
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pagedRows = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  /** Rows that probably duplicate a transaction already in the ledger. */
  const duplicateIdx = useMemo(() => {
    if (rows.length === 0 || ledgerTransactions.length === 0) return new Set<number>();
    const holdingSymbols = new Map(holdings.map((h) => [h.id, h.symbol]));
    return findDuplicateRows(rows, ledgerTransactions, holdingSymbols);
  }, [rows, ledgerTransactions, holdings]);
  const duplicateCount = duplicateIdx.size;

  function matchAccount(parsed: { account_type: string }): string {
    const byType = accountList.find(
      (a) => a.account_type.toLowerCase() === parsed.account_type.toLowerCase(),
    );
    return byType?.id ?? accountList[0]?.id ?? "";
  }

  /** Pre-fills the mapping card: match on name first, then on tax wrapper. */
  function defaultMapping(list: CsvPortfolio[]): Record<string, Mapping> {
    const next: Record<string, Mapping> = {};
    for (const p of list) {
      const byName = accountList.find(
        (a) => a.account_name.toLowerCase().trim() === p.name.toLowerCase().trim(),
      );
      const byType = accountList.find(
        (a) => a.account_type.toLowerCase() === p.suggestedType.toLowerCase(),
      );
      next[p.name] = {
        target: byName?.id ?? byType?.id ?? "new",
        accountType: p.suggestedType,
        // Suggested currency for a newly created account; the user confirms it
        // in the mapping step. Unknown stays a plain CAD starting point here,
        // never a claim about the file.
        currency: p.currency ?? "CAD",
        ownerType: "self",
        memberName: "",
      };
    }
    return next;
  }

  /** Creates any missing accounts and points every row at the right one. */
  async function applyMapping() {
    setBusy(true);
    try {
      const resolved: Record<string, string> = {};
      for (const p of portfolios) {
        const m = mapping[p.name];
        if (!m) continue;
        if (m.target === "new") {
          resolved[p.name] = await createAccount({
            accountType: m.accountType,
            accountName: p.name,
            currency: m.currency,
            institution: "",
            ownerType: m.ownerType,
            memberName: m.memberName,
          });
        } else if (m.target !== "skip") {
          resolved[p.name] = m.target;
        }
      }
      await accounts.refetch();
      setRows((prev) =>
        prev
          .filter((r) => !r.portfolio || resolved[r.portfolio])
          .map((r) => ({
            ...r,
            accountId: r.portfolio ? (resolved[r.portfolio] ?? r.accountId) : r.accountId,
          })),
      );
      setPortfolios([]);
      toast.success("Accounts mapped — review the transactions below.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the accounts.");
    } finally {
      setBusy(false);
    }
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
    // Route on the file's actual content, not its name: spreadsheets are
    // already structured, so they are read directly here — no AI, no size
    // ceiling, no credits, and every row comes through.
    let kind: ReturnType<typeof classifyFile>;
    try {
      kind = classifyFile(await readHeaderBytes(file), file.name, file.type);
    } catch {
      toast.error("Could not read that file.");
      return;
    }
    if (kind === "unknown") {
      toast.error(
        "That file does not look like a CSV, PDF or photo of a statement. Try one of those.",
      );
      return;
    }
    if (kind !== "csv-text" && !isPro) {
      setUpgradeReason(
        "Reading PDFs and screenshots with AI is the one paid feature — $10 a year. CSV files and hand entry are always free.",
      );
      setUpgradeOpen(true);
      return;
    }
    setBusy(true);
    setPage(0);
    setLearnCandidate(null);
    try {
      if (kind === "csv-text") {
        const text = await readAsText(file);
        let result;
        try {
          result = parseCsvText(text, file.name, learnedProfiles);
        } catch (parseError) {
          // The deterministic parser could not read this layout. Pro users
          // get it learned automatically in the background; free users are
          // pointed at the upgrade.
          const message = parseError instanceof Error ? parseError.message : "";
          if (/header row/i.test(message)) {
            if (!isPro) {
              setUpgradeReason(
                "That CSV's layout is unfamiliar. Pro learns its columns automatically — once learned, the layout imports free forever.",
              );
              setUpgradeOpen(true);
              return;
            }
            await runLearnLayout({ fileName: file.name, text });
            return;
          }
          throw parseError;
        }
        setBroker(`${result.broker} · read directly, no AI credits used`);
        setRows(
          result.transactions.map((t, i) => ({
            account_type: mapping[t.portfolio]?.accountType ?? "Non-Registered",
            account_hint: t.portfolio,
            date: t.date,
            type: t.type,
            symbol: t.symbol,
            name: null,
            quantity: t.quantity,
            price: t.price,
            amount: t.amount,
            currency: t.currency,
            fee: t.fee,
            // Profile-matched rows read at full confidence; heuristic rows
            // arrive at 0.7 so review highlights them.
            confidence: t.confidence ?? 1,
            note: t.note,
            rowId: `csv-${i}`,
            portfolio: t.portfolio,
            fx: t.fx,
            accountId: "",
          })) as Row[],
        );
        setPortfolios(result.portfolios);
        setMapping(defaultMapping(result.portfolios));
        if (result.transactions.length === 0) {
          toast.warning("No transactions found in that file.");
        } else {
          toast.success(
            `Read ${result.transactions.length} transactions${result.skipped ? ` (${result.skipped} lines skipped)` : ""} — choose where each portfolio goes.`,
          );
        }
        return;
      }
      // PDFs and photos go to the Gemini-backed server function, which is
      // authenticated and enforces the Pro plan on the server. Rows arrive
      // in the canonical ParsedTransaction shape and map 1:1 — no coercion:
      // types, fees and confidences are exactly what the reader returned.
      const result = await parseStatementFn({
        data: {
          fileName: file.name,
          mimeType: file.type || (kind === "pdf" ? "application/pdf" : "image/png"),
          dataUrl: await readAsDataUrl(file),
          text: null,
        },
      });
      setBroker(result.broker ? `${result.broker} · read by AI` : "Read by AI");
      const extractedRows = result.transactions.map((t, i): Row => {
        const accountId = matchAccount(t);
        const accountCurrency = accountList.find((a) => a.id === accountId)?.currency;
        const currencyNote =
          !t.currency && accountCurrency
            ? "Currency not shown on the statement; using the account's currency — verify."
            : null;
        return {
          account_type: t.account_type,
          account_hint: t.account_hint,
          date: t.date,
          type: t.type,
          symbol: t.symbol,
          name: t.name,
          quantity: t.quantity,
          price: t.price,
          amount: t.amount,
          currency: t.currency ?? accountCurrency ?? "CAD",
          fee: t.fee ?? 0,
          confidence: t.confidence,
          note: [t.note, currencyNote].filter(Boolean).join(" ") || null,
          rowId: `ai-${i}`,
          accountId,
        };
      });
      setRows(extractedRows);
      if (extractedRows.length === 0) {
        toast.warning("No transactions found in that file.");
      } else {
        toast.success(`Found ${extractedRows.length} transactions — review them below.`);
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

  /**
   * Ask the AI to map an unfamiliar CSV's columns, save the layout on this
   * device, and re-parse deterministically. One paid call; every future
   * import of the same format is free. Runs automatically for Pro users;
   * the retry card appears only if the automatic attempt fails.
   */
  async function runLearnLayout(candidate: { fileName: string; text: string }) {
    if (learning) return;
    setLearning(true);
    try {
      const sample = candidate.text.split("\n").slice(0, 30).join("\n");
      const learned = await learnMappingFn({
        data: { fileName: candidate.fileName, sample },
      });
      // Fingerprint against the live header row so the saved layout matches
      // exactly what the parser will see: the row containing the mapped date
      // column wins.
      const { parseCsvTable } = await import("@/lib/csv-parse");
      const { normalizeHeader } = await import("@/lib/institution-profiles");
      const table = parseCsvTable(candidate.text);
      const dateHeader = normalizeHeader(learned.columns.date);
      const headerRow = table
        .slice(0, 25)
        .find((row) => row.some((cell) => normalizeHeader(cell) === dateHeader));
      if (!headerRow) throw new Error("Could not locate the header row in that file.");
      // Drop unmapped fields so the profile only claims what the AI found.
      const columns = Object.fromEntries(
        Object.entries(learned.columns).filter(([, v]) => v != null),
      ) as Partial<Record<LearnedColumnField, string>>;
      const profile = buildLearnedProfile({
        name: learned.institution_name,
        headers: headerRow,
        columns,
        typeMap: learned.type_map,
      });
      const next = saveLearnedProfile(profile);
      setLearnedProfiles(next);
      const result = parseCsvText(candidate.text, candidate.fileName, next);
      setBroker(`${result.broker} · layout learned, no AI credits used from here on`);
      setRows(
        result.transactions.map((t, i) => ({
          account_type: "Non-Registered",
          account_hint: t.portfolio,
          date: t.date,
          type: t.type,
          symbol: t.symbol,
          name: null,
          quantity: t.quantity,
          price: t.price,
          amount: t.amount,
          currency: t.currency,
          fee: t.fee ?? 0,
          confidence: t.confidence ?? 0.9,
          note: t.note,
          rowId: `learned-${i}`,
          portfolio: t.portfolio,
          fx: t.fx,
          accountId: "",
        })),
      );
      setPortfolios(result.portfolios);
      setMapping(defaultMapping(result.portfolios));
      setLearnCandidate(null);
      toast.success(
        `Learned the "${profile.name}" layout — saved on this device. Future files in this format import automatically.`,
      );
    } catch (error) {
      // Leave the retry card up so the user can try again manually.
      setLearnCandidate(candidate);
      toast.error(error instanceof Error ? error.message : "Could not learn that layout.");
    } finally {
      setLearning(false);
    }
  }

  /** A row is committable when it has a type, a date, and some value to record. */
  function isRowIncomplete(row: Row): boolean {
    const hasValue =
      row.amount != null || (row.quantity != null && row.price != null);
    return !row.type || !row.date || !hasValue;
  }

  /**
   * Total derivable from a row's own numbers (units × price). Pure arithmetic
   * on what the file showed — nothing guessed — so it is safe to display and
   * to use when the reader left the amount blank.
   */
  function derivedAmount(row: Pick<Row, "quantity" | "price">): number | null {
    if (row.quantity == null || row.price == null) return null;
    return Math.round(row.quantity * row.price * 100) / 100;
  }

  async function commit() {
    if (rows.length === 0) return;
    const missing = rows.filter((r) => !r.accountId);
    if (missing.length > 0) {
      toast.error("Pick an account for every row first.");
      return;
    }
    const incomplete = rows.filter(isRowIncomplete);
    if (incomplete.length > 0) {
      toast.error(
        `${incomplete.length} row${incomplete.length === 1 ? " is" : "s are"} missing a type, date, or value. Fill in the highlighted rows first.`,
      );
      return;
    }

    setSaving(true);
    setProgress(0);
    let saved = 0;
    const rateCache = new Map<string, number>();
    const rateFor = async (currency: string, date: string, fx?: number): Promise<number> => {
      if (currency !== "USD") return 1;
      // A rate supplied by the file is the actual trade-date rate — keep it.
      if (fx && fx > 0 && fx !== 1) return fx;
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
        // Guarded by the incomplete-rows check above; the assertions keep the types honest.
        const rowType = row.type!;
        const rowDate = row.date!;
        const rowCurrency = row.currency ?? "CAD";
        const units = row.quantity ?? 0;
        const price = row.price ?? 0;
        const cashAmount = row.amount ?? derivedAmount(row) ?? 0;
        await addTransaction.mutateAsync({
          accountId: row.accountId,
          symbol: row.symbol ?? "",
          name: row.name,
          assetType: "Stock",
          transactionType: rowType,
          units,
          pricePerUnit: price,
          amount: ["DIVIDEND", "DEPOSIT", "WITHDRAWAL", "FEE"].includes(rowType)
            ? cashAmount
            : null,
          currency: rowCurrency,
          fxRate: await rateFor(rowCurrency, rowDate, row.fx),
          fee: row.fee ?? 0,
          date: rowDate,
        });
        saved += 1;
        if (saved % 25 === 0 || saved === rows.length) setProgress(saved);
        // Let the browser breathe between batches on very large imports.
        if (saved % SAVE_BATCH === 0) await new Promise((r) => setTimeout(r, 0));
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
            <p className="text-sm font-medium">
              {learning ? "Learning this CSV's layout…" : "Reading your statement…"}
            </p>
            <p className="text-xs text-muted-foreground">
              {learning
                ? "One quick AI look at the columns — then it's saved and free forever."
                : "This can take up to a minute for long PDFs."}
            </p>
          </>
        ) : (
          <>
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <FileUp className="h-5 w-5" />
            </span>
            <p className="text-sm font-medium">Drag a file here</p>
            <p className="text-xs text-muted-foreground">
              {isPro
                ? "CSV, PDF, PNG or JPEG · up to 20 MB · spreadsheets of any length"
                : "CSV files are free and unlimited — PDFs and photos need the $10 / year plan"}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
                {isPro ? (
                  <Sparkles className="mr-1.5 h-4 w-4" />
                ) : (
                  <Lock className="mr-1.5 h-4 w-4" />
                )}
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

      {learnCandidate && !busy && !learning ? (
        <div className="panel flex flex-col items-center gap-3 p-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Wand2 className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-medium">Couldn't learn this layout automatically</p>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">
              The automatic attempt for {learnCandidate.fileName} failed. You can try again — once
              the layout is learned it is saved on this device and future files import free.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button
              size="sm"
              disabled={learning}
              onClick={() => void runLearnLayout(learnCandidate)}
            >
              {learning ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {learning ? "Learning the layout…" : "Try learning again"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setLearnCandidate(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      {portfolios.length > 0 ? (
        <div className="panel overflow-hidden">
          <div className="border-b px-5 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Map your portfolios
            </h2>
            <p className="text-xs text-muted-foreground">
              We found {portfolios.length} portfolios in that file. Choose where each one lands —
              every transaction inside it follows in one step.
            </p>
          </div>
          <div className="divide-y">
            {portfolios.map((p) => {
              const m = mapping[p.name];
              if (!m) return null;
              const setM = (patch: Partial<Mapping>) =>
                setMapping((prev) => ({ ...prev, [p.name]: { ...m, ...patch } }));
              return (
                <div key={p.name} className="grid gap-3 px-5 py-4 md:grid-cols-4 md:items-end">
                  <div>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.count} transactions · {p.currency}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Goes to</Label>
                    <Select value={m.target} onValueChange={(v) => setM({ target: v })}>
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {accountList.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.account_name} · {a.account_type}
                          </SelectItem>
                        ))}
                        <SelectItem value="new">+ Create a new account</SelectItem>
                        <SelectItem value="skip">Skip this portfolio</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {m.target === "new" ? (
                    <>
                      <div className="space-y-1.5">
                        <Label>Account type</Label>
                        <Select
                          value={m.accountType}
                          onValueChange={(v) => setM({ accountType: v })}
                        >
                          <SelectTrigger className="h-9">
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
                        <Label>Whose account</Label>
                        <div className="flex gap-2">
                          <Select
                            value={m.ownerType}
                            onValueChange={(v) => setM({ ownerType: v })}
                          >
                            <SelectTrigger className="h-9">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="self">{OWNER_LABELS["self"]}</SelectItem>
                              <SelectItem value="partner">{OWNER_LABELS["partner"]}</SelectItem>
                              <SelectItem value="child">{OWNER_LABELS["child"]}</SelectItem>
                            </SelectContent>
                          </Select>

                          {m.ownerType !== "self" ? (
                            <Input
                              className="h-9"
                              placeholder="Name"
                              value={m.memberName}
                              onChange={(e) => setM({ memberName: e.target.value })}
                            />
                          ) : null}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="md:col-span-2 text-xs text-muted-foreground">
                      {m.target === "skip"
                        ? "These transactions will be dropped."
                        : "Existing account — nothing new is created."}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRows([]);
                setPortfolios([]);
                setBroker(null);
              }}
            >
              Discard
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void applyMapping()}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Apply mapping
            </Button>
          </div>
        </div>
      ) : null}

      {rows.length > 0 && portfolios.length === 0 ? (
        <div className="panel overflow-hidden">
          {duplicateCount > 0 ? (
            <div className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-5 py-3 text-sm">
              <Copy className="h-4 w-4 shrink-0 text-amber-600" />
              <p>
                <span className="font-medium">{duplicateCount} row{duplicateCount === 1 ? "" : "s"}{" "}
                {duplicateCount === 1 ? "looks" : "look"} like {duplicateCount === 1 ? "a duplicate" : "duplicates"}</span>{" "}
                of {duplicateCount === 1 ? "a transaction" : "transactions"} already in your ledger. They're
                flagged below — remove {duplicateCount === 1 ? "it" : "them"} or approve anyway.
              </p>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Review {rows.length} transactions
              </h2>
              {broker ? <p className="text-xs text-muted-foreground">Detected: {broker}</p> : null}
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
                {saving && rows.length > PAGE_SIZE
                  ? `Saving ${progress} of ${rows.length}…`
                  : "Approve & add to ledger"}
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
                {pagedRows.map((row, pageIndex) => {
                  const low = row.confidence < 0.8;
                  const incomplete = isRowIncomplete(row);
                  const isDupe = duplicateIdx.has(page * PAGE_SIZE + pageIndex);
                  // Show the derivable total when the reader left amount blank;
                  // anything the user types replaces it.
                  const derived = row.amount == null ? derivedAmount(row) : null;
                  const amountValue = row.amount ?? derived;
                  return (
                    <TableRow
                      key={row.rowId}
                      className={incomplete ? "bg-amber-500/10" : low ? "bg-primary/5" : undefined}
                    >
                      <TableCell className="whitespace-nowrap">
                        {isDupe ? (
                          <span
                            className="flex items-center gap-1 text-xs text-amber-600"
                            title="This row matches a transaction already in your ledger"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            Duplicate?
                          </span>
                        ) : low ? (
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
                          value={row.date ?? ""}
                          onChange={(e) => update(row.rowId, { date: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Select
                          value={row.type ?? ""}
                          onValueChange={(v) => update(row.rowId, { type: v })}
                        >
                          <SelectTrigger className="h-8 w-32">
                            <SelectValue placeholder="Pick type" />
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
                          onChange={(e) =>
                            update(row.rowId, { price: Number(e.target.value) || 0 })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="num h-8 w-24 text-right"
                          value={amountValue ?? ""}
                          title={
                            derived != null
                              ? `Computed: ${row.quantity} × ${row.price}`
                              : undefined
                          }
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
                          value={row.currency ?? undefined}
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
          {totalPages > 1 ? (
            <div className="flex items-center justify-between gap-3 border-t px-5 py-3 text-sm">
              <span className="text-muted-foreground">
                Showing {page * PAGE_SIZE + 1}–{Math.min(rows.length, (page + 1) * PAGE_SIZE)} of{" "}
                {rows.length}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
          <p className="border-t px-5 py-3 text-xs text-muted-foreground">
            Rows highlighted in red were uncertain — check the date, amount and account before
            approving. Account types recognised: {ACCOUNT_TYPES.join(", ")}.
          </p>
        </div>
      ) : null}

      {learnedProfiles.length > 0 ? (
        <div className="panel overflow-hidden">
          <div className="border-b px-5 py-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Learned CSV layouts
            </h2>
            <p className="text-xs text-muted-foreground">
              Formats AI mapped for you, saved on this device. Matching files import automatically —
              no AI needed.
            </p>
          </div>
          <div className="divide-y">
            {learnedProfiles.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div>
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.headerFingerprint.length} columns · saved{" "}
                    {new Date(p.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Forget the ${p.name} layout`}
                  onClick={() => {
                    setLearnedProfiles(deleteLearnedProfile(p.id));
                    toast.success(`Forgot the "${p.name}" layout.`);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <UpgradeDialog
        open={upgradeOpen}
        onOpenChange={(o) => {
          setUpgradeOpen(o);
          if (!o) setUpgradeReason(null);
        }}
        reason={
          upgradeReason
            ? upgradeReason
            : entitlement.readOnly
              ? "Your plan has ended, so Apis Financial is view-only. Restart Pro to import again."
              : "This import goes past the free plan's ten holdings. Pro removes the limit."
        }
      />
    </div>
  );
}
