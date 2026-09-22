import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getQuotes } from "./market.functions";
import type { Account, Holding, Quote, Transaction } from "./finance";

export function useAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<Account[]> => {
      const { data, error } = await supabase
        .from("accounts")
        .select(
          "id, account_type, account_name, currency, institution, track_cash, owner_type, member_name",
        )
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useHoldings() {
  return useQuery({
    queryKey: ["holdings"],
    queryFn: async (): Promise<Holding[]> => {
      const { data, error } = await supabase
        .from("holdings")
        .select("id, account_id, symbol, name, asset_type, currency")
        .order("symbol");
      if (error) throw error;
      return data ?? [];
    },
  });
}

const PAGE = 1000;

export function useTransactions() {
  return useQuery({
    queryKey: ["transactions"],
    queryFn: async (): Promise<Transaction[]> => {
      // The database returns at most 1000 rows per request, so keep asking for
      // the next page until every transaction has been loaded. Share counts,
      // cost base and account values are wrong if any history is missing.
      const all: Transaction[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from("transactions")
          .select(
            "id, account_id, holding_id, transaction_type, units, price_per_unit, amount, currency, fx_rate, fee, transaction_date",
          )
          .order("transaction_date", { ascending: false })
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const batch = data ?? [];
        for (const t of batch) {
          all.push({
            ...t,
            units: Number(t.units),
            price_per_unit: Number(t.price_per_unit),
            amount: t.amount == null ? null : Number(t.amount),
            fx_rate: Number(t.fx_rate),
            fee: Number(t.fee),
          });
        }
        if (batch.length < PAGE) break;
      }
      return all;
    },
  });
}


export function useQuotes(symbols: string[]) {
  const fetchQuotes = useServerFn(getQuotes);
  const key = Array.from(new Set(symbols.map((s) => s.toUpperCase()))).sort();
  return useQuery({
    queryKey: ["quotes", key],
    enabled: true,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => fetchQuotes({ data: { symbols: key } }),
  });
}

/** Forces a fresh pull from the market data provider, bypassing the daily cache. */
export function useRefreshPrices(symbols: string[]) {
  const fetchQuotes = useServerFn(getQuotes);
  const qc = useQueryClient();
  const key = Array.from(new Set(symbols.map((s) => s.toUpperCase()))).sort();
  return useMutation({
    mutationFn: async () => fetchQuotes({ data: { symbols: key, force: true } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["quotes"] });
    },
  });
}

export type PortfolioData = {
  accounts: Account[];
  holdings: Holding[];
  transactions: Transaction[];
  quotes: Record<string, Quote>;
  fxUsdCad: number;
  pricesAsOf: string | null;
  missingPrices: string[];
  refreshingPrices: boolean;
  refreshPrices: () => void;
  loading: boolean;
};

export function usePortfolio(): PortfolioData {
  const accounts = useAccounts();
  const holdings = useHoldings();
  const transactions = useTransactions();
  const symbols = (holdings.data ?? []).map((h) => h.symbol);
  const quotes = useQuotes(symbols);
  const refresh = useRefreshPrices(symbols);

  const quoteMap: Record<string, Quote> = {};
  for (const q of quotes.data?.quotes ?? []) {
    quoteMap[q.symbol.toUpperCase()] = {
      symbol: q.symbol,
      price: q.price,
      previousClose: q.previousClose,
      currency: q.currency,
      name: q.name,
      dividendRate: q.dividendRate,
      dividendYield: q.dividendYield,
      exDivDate: q.exDivDate,
      exDivAmount: q.exDivAmount,
    };
  }

  const missingPrices = Array.from(new Set(symbols.map((s) => s.toUpperCase()))).filter(
    (s) => quoteMap[s]?.price == null,
  );

  return {
    accounts: accounts.data ?? [],
    holdings: holdings.data ?? [],
    transactions: transactions.data ?? [],
    quotes: quoteMap,
    fxUsdCad: quotes.data?.fxUsdCad ?? 1.37,
    pricesAsOf: quotes.data?.pricesAsOf ?? null,
    missingPrices,
    refreshingPrices: refresh.isPending || quotes.isFetching,
    refreshPrices: () => refresh.mutate(),
    loading: accounts.isLoading || holdings.isLoading || transactions.isLoading,
  };
}


export function useInvalidatePortfolio() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["accounts"] });
    void qc.invalidateQueries({ queryKey: ["holdings"] });
    void qc.invalidateQueries({ queryKey: ["transactions"] });
  };
}

export type NewTransaction = {
  accountId: string;
  symbol: string;
  name?: string | null;
  assetType: string;
  transactionType: string;
  units: number;
  pricePerUnit: number;
  amount: number | null;
  currency: string;
  fxRate: number;
  fee: number;
  date: string;
};

async function ensureHolding(
  userId: string,
  accountId: string,
  symbol: string,
  name: string | null,
  assetType: string,
  currency: string,
): Promise<string> {
  const upper = symbol.trim().toUpperCase();
  const { data: existing } = await supabase
    .from("holdings")
    .select("id")
    .eq("account_id", accountId)
    .eq("symbol", upper)
    .maybeSingle();
  if (existing) return existing.id;

  const { data, error } = await supabase
    .from("holdings")
    .insert({
      user_id: userId,
      account_id: accountId,
      symbol: upper,
      name,
      asset_type: assetType,
      currency,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

const NEEDS_SYMBOL = ["BUY", "SELL", "DIVIDEND", "DRIP", "SPLIT"];

export function useAddTransaction() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: async (input: NewTransaction) => {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) throw new Error("You need to be signed in.");

      let holdingId: string | null = null;
      if (NEEDS_SYMBOL.includes(input.transactionType) && input.symbol.trim()) {
        holdingId = await ensureHolding(
          userId,
          input.accountId,
          input.symbol,
          input.name ?? null,
          input.assetType,
          input.currency,
        );
      }

      const { error } = await supabase.from("transactions").insert({
        user_id: userId,
        account_id: input.accountId,
        holding_id: holdingId,
        transaction_type: input.transactionType,
        units: input.units,
        price_per_unit: input.pricePerUnit,
        amount: input.amount,
        currency: input.currency,
        fx_rate: input.fxRate,
        fee: input.fee,
        transaction_date: input.date,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export type TransactionEdit = {
  id: string;
  accountId: string;
  symbol: string;
  name?: string | null;
  assetType: string;
  transactionType: string;
  units: number;
  pricePerUnit: number;
  amount: number | null;
  currency: string;
  fxRate: number;
  fee: number;
  date: string;
};

export function useUpdateTransaction() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: async (input: TransactionEdit) => {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      if (!userId) throw new Error("You need to be signed in.");

      let holdingId: string | null = null;
      if (NEEDS_SYMBOL.includes(input.transactionType) && input.symbol.trim()) {
        holdingId = await ensureHolding(
          userId,
          input.accountId,
          input.symbol,
          input.name ?? null,
          input.assetType,
          input.currency,
        );
      }

      const { error } = await supabase
        .from("transactions")
        .update({
          account_id: input.accountId,
          holding_id: holdingId,
          transaction_type: input.transactionType,
          units: input.units,
          price_per_unit: input.pricePerUnit,
          amount: input.amount,
          currency: input.currency,
          fx_rate: input.fxRate,
          fee: input.fee,
          transaction_date: input.date,
        })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useDeleteTransaction() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("transactions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export type NewAccount = {
  accountType: string;
  accountName: string;
  currency: string;
  institution: string;
  trackCash?: boolean;
  ownerType?: string;
  memberName?: string | null;
};

/** Creates an account and returns its id, so imports can map straight onto it. */
export async function createAccount(input: NewAccount): Promise<string> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("You need to be signed in.");
  const { data, error } = await supabase
    .from("accounts")
    .insert({
      user_id: userId,
      account_type: input.accountType,
      account_name: input.accountName,
      currency: input.currency,
      institution: input.institution || null,
      track_cash: input.trackCash ?? false,
      owner_type: input.ownerType ?? "self",
      member_name: input.memberName?.trim() || null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export function useAddAccount() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: createAccount,
    onSuccess: invalidate,
  });
}

export function useUpdateAccount() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      trackCash?: boolean;
      ownerType?: string;
      memberName?: string | null;
    }) => {
      const patch: {
        track_cash?: boolean;
        owner_type?: string;
        member_name?: string | null;
      } = {};
      if (input.trackCash !== undefined) patch["track_cash"] = input.trackCash;
      if (input.ownerType !== undefined) patch["owner_type"] = input.ownerType;
      if (input.memberName !== undefined) patch["member_name"] = input.memberName?.trim() || null;
      const { error } = await supabase.from("accounts").update(patch).eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}


export function useDeleteAccount() {
  const invalidate = useInvalidatePortfolio();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("accounts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}
