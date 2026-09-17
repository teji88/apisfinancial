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
};

const COLUMNS =
  "id, display_name, base_currency, province, current_age, target_retirement_age, inflation_rate, growth_rate, life_expectancy, marital_status, spouse_age, spouse_rrsp, spouse_tfsa, spouse_income, desired_income, cpp_start_age, cpp_pct, oas_start_age, manual_override, override_tfsa, override_rrsp, override_lira, override_fhsa, override_nonreg";

function toNumbers(row: Record<string, unknown>): Profile {
  const num = (v: unknown, fallback = 0) => (v == null ? fallback : Number(v));
  return {
    ...(row as unknown as Profile),
    inflation_rate: num(row['inflation_rate'], 2.5),
    growth_rate: num(row['growth_rate'], 6),
    life_expectancy: num(row['life_expectancy'], 95),
    spouse_rrsp: num(row['spouse_rrsp']),
    spouse_tfsa: num(row['spouse_tfsa']),
    spouse_income: num(row['spouse_income']),
    desired_income: num(row['desired_income'], 70000),
    cpp_pct: num(row['cpp_pct'], 75),
    override_tfsa: num(row['override_tfsa']),
    override_rrsp: num(row['override_rrsp']),
    override_lira: num(row['override_lira']),
    override_fhsa: num(row['override_fhsa']),
    override_nonreg: num(row['override_nonreg']),
  };
}

export function useProfile() {
  return useQuery({
    queryKey: ["profile"],
    queryFn: async (): Promise<Profile | null> => {
      const { data, error } = await supabase.from("profiles").select(COLUMNS).maybeSingle();
      if (error) throw error;
      return data ? toNumbers(data as unknown as Record<string, unknown>) : null;
    },
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Profile>) => {
      const { data: auth } = await supabase.auth.getUser();
      const id = auth.user?.id;
      if (!id) throw new Error("Not signed in");
      const { error } = await supabase.from("profiles").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["profile"] });
    },
  });
}
