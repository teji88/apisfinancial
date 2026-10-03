import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
};

const COLUMNS =
  "id, display_name, base_currency, province, current_age, target_retirement_age, inflation_rate, growth_rate, working_growth_rate, retirement_growth_rate, life_expectancy, marital_status, spouse_age, spouse_rrsp, spouse_tfsa, spouse_income, desired_income, cpp_start_age, cpp_pct, oas_start_age, manual_override, override_tfsa, override_rrsp, override_lira, override_fhsa, override_nonreg, annual_savings, save_pct_tfsa, save_pct_rrsp, save_pct_nonreg, cpp_avg_income, cpp_years_worked, cpp_future_income, oas_years_in_canada, spouse_retirement_age, spouse_cpp_avg_income, spouse_cpp_years_worked, spouse_cpp_future_income, spouse_oas_years_in_canada, spouse_cpp_start_age, spouse_oas_start_age, spouse_lira, spouse_nonreg";

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
