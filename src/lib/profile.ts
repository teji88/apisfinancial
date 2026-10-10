import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { HoldingTaxType, LocAccount } from "@/lib/retirement/optimization/AssetLocation";

/** User-entered DB pension inputs (today's dollars). Mirrors the DbPension domain type. */
export type DbPensionInput = {
  enabled: boolean;
  name?: string;
  /** Monthly pension at the normal retirement age, today's $/mo. */
  monthlyAmountAtNRA: number;
  normalRetirementAge: number;
  /** Chosen commencement age. */
  startAge: number;
  /** Reduction per year commenced before NRA, as a decimal (e.g. 0.03). */
  earlyReductionPerYear: number;
  /** Increase per year commenced after NRA, as a decimal. */
  lateIncreasePerYear: number;
  indexing: "none" | "full" | "partial";
  /** For "partial": fraction of CPI applied (0-1). */
  indexingFraction: number;
  /** Bridge benefit monthly amount, today's $/mo (0 = none). */
  bridgeMonthly: number;
  /** Bridge paid while age < bridgeEndAge (typically 65). Null = no bridge. */
  bridgeEndAge: number | null;
  /** Survivor benefit as % of member's pension (0-100). */
  survivorPercent: number;
};

/** A holding classified for the asset-location optimizer. */
export type AssetHoldingInput = {
  id: string;
  name: string;
  taxType: HoldingTaxType;
  /** Current market value ($). */
  value: number;
  /** Annual distribution yield as a decimal (e.g. 0.035), gross of withholding. */
  yield: number;
  /** Where it sits today. */
  account: LocAccount;
};

/** Employer RRSP/pension match details for the savings allocator. */
export type EmployerMatchInput = {
  offered: boolean;
  /** Employer match rate as % (e.g. 50 = 50 cents per dollar). */
  matchRatePct: number;
  /** Max employee contribution matched, as % of salary. */
  maxPctOfSalary: number;
};

/** One debt in the shared inventory (net worth, comparator, Smith facilities). */
export type DebtInput = {
  id: string;
  name: string;
  /** mortgage | heloc | loan | credit_card | other */
  kind: "mortgage" | "heloc" | "loan" | "credit_card" | "other";
  /** Outstanding balance ($). */
  balance: number;
  /** Annual interest rate as a decimal (e.g. 0.055). */
  rate: number;
  /** Regular payment ($/mo). */
  payment: number;
  /** Whether interest is tax-deductible (e.g. investment loan). */
  deductible: boolean;
};

/** Illiquid property values for net worth; liquid assets come from balances. */
export type NetWorthInput = {
  /** Principal residence value ($). */
  homeValue: number;
  /** Other property / cottage value ($). */
  otherPropertyValue: number;
  /** Cash / savings accounts ($) — liquid. */
  cash: number;
};

/**
 * One Smith Manoeuvre tranche — each re-borrow draw is a separate tranche
 * (Singleton principle). Fields follow the verified CRA tracing rules:
 * ITA s.20(1)(c), Folio S3-F6-C1.
 */
export type SmithTranche = {
  id: string;
  /** HELOC/facility this was drawn from (links to a DebtInput). */
  facility: string;
  /** Draw date (YYYY-MM-DD). */
  drawDate: string;
  /** Principal advanced ($). */
  principal: number;
  /** Annual interest rate as a decimal. */
  rate: number;
  /** Where the money went (destination account/security). */
  useOfFunds: string;
  /** Destination classification: income-earning (eligible) or not. */
  eligible: boolean;
  /** Why the purpose test is met at acquisition (e.g. dividend policy). */
  purposeEvidence: string;
  /** Interest paid year-to-date ($). */
  interestPaidYtd: number;
  repayments: Array<{ date: string; amount: number }>;
  /** Current use turned personal — kills deductibility from this date. */
  personalUse: boolean;
  personalUseDate: string | null;
  /** Funds passed through an account with other cash (para 1.42 regime). */
  commingled: boolean;
  disposition: {
    date: string;
    proceeds: number;
    destination: "reinvested" | "personal" | "loan_repayment";
  } | null;
  /** s.20.1 deemed eligible balance after a loss disposition. */
  s201Deemed: number;
  /** Source-document pointers (free text). */
  documents: string;
};

/** One investment property (real estate tab). Mortgage links to a DebtInput by id. */
export type PropertyInput = {
  id: string;
  name: string;
  /** Current estimated value ($). */
  currentValue: number;
  /** DebtInput id of the mortgage, or "" if free-and-clear / manual. */
  mortgageId: string;
  /** Manual mortgage balance ($) when not linked. */
  mortgageBalance: number;
  /** Manual mortgage payment ($/mo) when not linked. */
  mortgagePayment: number;
  monthlyRent: number;
  /** Parking, laundry, etc. ($/mo). */
  otherIncome: number;
  /** Vacancy allowance (% of gross). */
  vacancyPct: number;
  /** Cash invested: down payment + closing ($). */
  cashInvested: number;
  expenses: {
    propertyTax: number; // $/yr
    insurance: number; // $/yr
    maintenance: number; // $/yr
    managementPct: number; // % of effective income
    condoFees: number; // $/yr
    utilities: number; // $/yr landlord-paid
    other: number; // $/yr
  };
};

export type Profile = {
  id: string;
  display_name: string | null;
  base_currency: string;
  province: string;
  current_age: number | null;
  target_retirement_age: number | null;
  inflation_rate: number;
  growth_rate: number;
  working_growth_rate: number;
  retirement_growth_rate: number;
  life_expectancy: number;
  marital_status: string;
  spouse_age: number | null;
  spouse_rrsp: number;
  spouse_tfsa: number;
  spouse_income: number;
  /** Main user's other pension income in retirement (today's $/yr). */
  income: number;
  desired_income: number;
  cpp_start_age: number;
  cpp_pct: number;
  oas_start_age: number;
  manual_override: boolean;
  override_tfsa: number;
  override_rrsp: number;
  override_lira: number;
  override_fhsa: number;
  override_nonreg: number;
  annual_savings: number;
  save_pct_tfsa: number;
  save_pct_rrsp: number;
  save_pct_nonreg: number;
  cpp_avg_income: number;
  cpp_years_worked: number;
  cpp_future_income: number;
  // Detailed CPP earnings history (new - uses CppCalculator)
  cpp_detailed_history?: Array<{ year: number; earnings: number }>;
  cpp_detailed_future_earnings?: number;
  cpp_detailed_child_rearing?: number[];
  oas_years_in_canada: number;
  spouse_retirement_age: number | null;
  spouse_cpp_avg_income: number;
  spouse_cpp_years_worked: number;
  spouse_cpp_future_income: number;
  // Detailed spouse CPP earnings history (mirrors self's - in-memory only)
  spouse_cpp_detailed_history?: Array<{ year: number; earnings: number }>;
  spouse_cpp_detailed_future_earnings?: number;
  spouse_cpp_detailed_child_rearing?: number[];
  spouse_oas_years_in_canada: number;
  spouse_cpp_start_age: number;
  spouse_oas_start_age: number;
  spouse_lira: number;
  spouse_nonreg: number;
  /** DB pension inputs (JSONB, null = none entered). */
  db_pension: DbPensionInput | null;
  /** Holdings classified for asset location (JSONB, null = none entered). */
  asset_holdings: AssetHoldingInput[] | null;
  /** Employer match details (JSONB, null = none entered). */
  employer_match: EmployerMatchInput | null;
  /** Shared debt inventory (JSONB, null = none entered). */
  debts: DebtInput[] | null;
  /** Illiquid property values for net worth (JSONB, null = none entered). */
  net_worth: NetWorthInput | null;
  /** Smith Manoeuvre tranche ledger (JSONB, null = none entered). */
  smith_tranches: SmithTranche[] | null;
  /** Investment properties (JSONB, null = none entered). */
  properties: PropertyInput[] | null;
};

const COLUMNS =
  "id, display_name, base_currency, province, current_age, target_retirement_age, inflation_rate, growth_rate, working_growth_rate, retirement_growth_rate, life_expectancy, marital_status, spouse_age, spouse_rrsp, spouse_tfsa, spouse_income, income, desired_income, cpp_start_age, cpp_pct, oas_start_age, manual_override, override_tfsa, override_rrsp, override_lira, override_fhsa, override_nonreg, annual_savings, save_pct_tfsa, save_pct_rrsp, save_pct_nonreg, cpp_avg_income, cpp_years_worked, cpp_future_income, oas_years_in_canada, spouse_retirement_age, spouse_cpp_avg_income, spouse_cpp_years_worked, spouse_cpp_future_income, spouse_oas_years_in_canada, spouse_cpp_start_age, spouse_oas_start_age, spouse_lira, spouse_nonreg, db_pension, asset_holdings, employer_match, debts, net_worth, smith_tranches, properties";

function toNumbers(row: Record<string, unknown>): Profile {
  const num = (v: unknown, fallback = 0) => (v == null ? fallback : Number(v));
  return {
    ...(row as unknown as Profile),
    inflation_rate: num(row["inflation_rate"], 2.5),
    growth_rate: num(row["growth_rate"], 6),
    working_growth_rate: num(row["working_growth_rate"], 6),
    retirement_growth_rate: num(row["retirement_growth_rate"], 4.5),
    life_expectancy: num(row["life_expectancy"], 95),
    spouse_rrsp: num(row["spouse_rrsp"]),
    spouse_tfsa: num(row["spouse_tfsa"]),
    spouse_income: num(row["spouse_income"]),
    income: num(row["income"]),
    desired_income: num(row["desired_income"], 70000),
    cpp_pct: num(row["cpp_pct"], 75),
    override_tfsa: num(row["override_tfsa"]),
    override_rrsp: num(row["override_rrsp"]),
    override_lira: num(row["override_lira"]),
    override_fhsa: num(row["override_fhsa"]),
    override_nonreg: num(row["override_nonreg"]),
    annual_savings: num(row["annual_savings"], 12000),
    save_pct_tfsa: num(row["save_pct_tfsa"], 40),
    save_pct_rrsp: num(row["save_pct_rrsp"], 40),
    save_pct_nonreg: num(row["save_pct_nonreg"], 20),
    cpp_avg_income: num(row["cpp_avg_income"]),
    cpp_years_worked: num(row["cpp_years_worked"]),
    cpp_future_income: num(row["cpp_future_income"]),
    oas_years_in_canada: num(row["oas_years_in_canada"], 40),
    spouse_cpp_avg_income: num(row["spouse_cpp_avg_income"]),
    spouse_cpp_years_worked: num(row["spouse_cpp_years_worked"]),
    spouse_cpp_future_income: num(row["spouse_cpp_future_income"]),
    spouse_oas_years_in_canada: num(row["spouse_oas_years_in_canada"], 40),
    spouse_cpp_start_age: num(row["spouse_cpp_start_age"], 65),
    spouse_oas_start_age: num(row["spouse_oas_start_age"], 65),
    spouse_lira: num(row["spouse_lira"]),
    spouse_nonreg: num(row["spouse_nonreg"]),
    db_pension: (row["db_pension"] as DbPensionInput | null) ?? null,
    asset_holdings: (row["asset_holdings"] as AssetHoldingInput[] | null) ?? null,
    employer_match: (row["employer_match"] as EmployerMatchInput | null) ?? null,
    debts: (row["debts"] as DebtInput[] | null) ?? null,
    net_worth: (row["net_worth"] as NetWorthInput | null) ?? null,
    smith_tranches: (row["smith_tranches"] as SmithTranche[] | null) ?? null,
    properties: (row["properties"] as PropertyInput[] | null) ?? null,
  };
}

async function getOrCreateProfile(): Promise<Profile | null> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;

  const user = auth.user;
  if (!user) return null;

  const { data, error } = await supabase.from("profiles").select(COLUMNS).maybeSingle();
  if (error) throw error;
  if (data) return toNumbers(data as unknown as Record<string, unknown>);

  // A trigger should normally create this row at signup. If it did not,
  // repair the profile here and let the database defaults populate all fields.
  const displayName =
    ((user.user_metadata as Record<string, unknown> | undefined)?.["display_name"] as
      | string
      | undefined) ??
    user.email?.split("@")[0] ??
    null;

  const { data: repaired, error: repairError } = await supabase
    .from("profiles")
    .upsert({ id: user.id, display_name: displayName }, { onConflict: "id" })
    .select(COLUMNS)
    .single();

  if (repairError) throw repairError;
  return toNumbers(repaired as unknown as Record<string, unknown>);
}

export function useProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: getOrCreateProfile,
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Profile>) => {
      const { data: auth } = await supabase.auth.getUser();
      const id = auth.user?.id;
      if (!id) throw new Error("Not signed in");

      // Strip detailed CPP history fields (not in Supabase schema yet - stored in-memory only)
      const {
        cpp_detailed_history,
        cpp_detailed_future_earnings,
        cpp_detailed_child_rearing,
        spouse_cpp_detailed_history,
        spouse_cpp_detailed_future_earnings,
        spouse_cpp_detailed_child_rearing,
        ...supabasePatch
      } = patch;
      const { error } = await supabase
        .from("profiles")
        .upsert({ id, ...supabasePatch }, { onConflict: "id" });

      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["profile"] });
    },
  });
}
