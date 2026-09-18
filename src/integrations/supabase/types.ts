export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          account_name: string
          account_type: string
          created_at: string
          currency: string
          id: string
          institution: string | null
          track_cash: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          account_name: string
          account_type: string
          created_at?: string
          currency?: string
          id?: string
          institution?: string | null
          track_cash?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          account_name?: string
          account_type?: string
          created_at?: string
          currency?: string
          id?: string
          institution?: string | null
          track_cash?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      holdings: {
        Row: {
          account_id: string
          asset_type: string
          created_at: string
          currency: string
          id: string
          name: string | null
          symbol: string
          user_id: string
        }
        Insert: {
          account_id: string
          asset_type?: string
          created_at?: string
          currency?: string
          id?: string
          name?: string | null
          symbol: string
          user_id: string
        }
        Update: {
          account_id?: string
          asset_type?: string
          created_at?: string
          currency?: string
          id?: string
          name?: string | null
          symbol?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "holdings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      invite_codes: {
        Row: {
          access_until: string | null
          code: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          max_uses: number
          note: string | null
          revoked: boolean
          updated_at: string
          uses: number
        }
        Insert: {
          access_until?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          max_uses?: number
          note?: string | null
          revoked?: boolean
          updated_at?: string
          uses?: number
        }
        Update: {
          access_until?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          max_uses?: number
          note?: string | null
          revoked?: boolean
          updated_at?: string
          uses?: number
        }
        Relationships: []
      }
      invite_redemptions: {
        Row: {
          access_until: string | null
          code_id: string
          id: string
          redeemed_at: string
          user_id: string
        }
        Insert: {
          access_until?: string | null
          code_id: string
          id?: string
          redeemed_at?: string
          user_id: string
        }
        Update: {
          access_until?: string | null
          code_id?: string
          id?: string
          redeemed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invite_redemptions_code_id_fkey"
            columns: ["code_id"]
            isOneToOne: false
            referencedRelation: "invite_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      price_cache: {
        Row: {
          as_of: string | null
          currency: string | null
          div_amount: number | null
          div_ex_date: string | null
          dividend_rate: number | null
          dividend_yield: number | null
          name: string | null
          previous_close: number | null
          price: number | null
          symbol: string
          updated_at: string
        }
        Insert: {
          as_of?: string | null
          currency?: string | null
          div_amount?: number | null
          div_ex_date?: string | null
          dividend_rate?: number | null
          dividend_yield?: number | null
          name?: string | null
          previous_close?: number | null
          price?: number | null
          symbol: string
          updated_at?: string
        }
        Update: {
          as_of?: string | null
          currency?: string | null
          div_amount?: number | null
          div_ex_date?: string | null
          dividend_rate?: number | null
          dividend_yield?: number | null
          name?: string | null
          previous_close?: number | null
          price?: number | null
          symbol?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          annual_savings: number
          base_currency: string
          cpp_avg_income: number
          cpp_future_income: number
          cpp_pct: number
          cpp_start_age: number
          cpp_years_worked: number
          created_at: string
          current_age: number | null
          desired_income: number
          display_name: string | null
          growth_rate: number
          id: string
          inflation_rate: number
          life_expectancy: number
          manual_override: boolean
          marital_status: string
          oas_start_age: number
          oas_years_in_canada: number
          override_fhsa: number
          override_lira: number
          override_nonreg: number
          override_rrsp: number
          override_tfsa: number
          province: string
          save_pct_nonreg: number
          save_pct_rrsp: number
          save_pct_tfsa: number
          spouse_age: number | null
          spouse_cpp_avg_income: number
          spouse_cpp_future_income: number
          spouse_cpp_start_age: number
          spouse_cpp_years_worked: number
          spouse_income: number
          spouse_lira: number
          spouse_nonreg: number
          spouse_oas_start_age: number
          spouse_oas_years_in_canada: number
          spouse_retirement_age: number | null
          spouse_rrsp: number
          spouse_tfsa: number
          target_retirement_age: number | null
          updated_at: string
        }
        Insert: {
          annual_savings?: number
          base_currency?: string
          cpp_avg_income?: number
          cpp_future_income?: number
          cpp_pct?: number
          cpp_start_age?: number
          cpp_years_worked?: number
          created_at?: string
          current_age?: number | null
          desired_income?: number
          display_name?: string | null
          growth_rate?: number
          id: string
          inflation_rate?: number
          life_expectancy?: number
          manual_override?: boolean
          marital_status?: string
          oas_start_age?: number
          oas_years_in_canada?: number
          override_fhsa?: number
          override_lira?: number
          override_nonreg?: number
          override_rrsp?: number
          override_tfsa?: number
          province?: string
          save_pct_nonreg?: number
          save_pct_rrsp?: number
          save_pct_tfsa?: number
          spouse_age?: number | null
          spouse_cpp_avg_income?: number
          spouse_cpp_future_income?: number
          spouse_cpp_start_age?: number
          spouse_cpp_years_worked?: number
          spouse_income?: number
          spouse_lira?: number
          spouse_nonreg?: number
          spouse_oas_start_age?: number
          spouse_oas_years_in_canada?: number
          spouse_retirement_age?: number | null
          spouse_rrsp?: number
          spouse_tfsa?: number
          target_retirement_age?: number | null
          updated_at?: string
        }
        Update: {
          annual_savings?: number
          base_currency?: string
          cpp_avg_income?: number
          cpp_future_income?: number
          cpp_pct?: number
          cpp_start_age?: number
          cpp_years_worked?: number
          created_at?: string
          current_age?: number | null
          desired_income?: number
          display_name?: string | null
          growth_rate?: number
          id?: string
          inflation_rate?: number
          life_expectancy?: number
          manual_override?: boolean
          marital_status?: string
          oas_start_age?: number
          oas_years_in_canada?: number
          override_fhsa?: number
          override_lira?: number
          override_nonreg?: number
          override_rrsp?: number
          override_tfsa?: number
          province?: string
          save_pct_nonreg?: number
          save_pct_rrsp?: number
          save_pct_tfsa?: number
          spouse_age?: number | null
          spouse_cpp_avg_income?: number
          spouse_cpp_future_income?: number
          spouse_cpp_start_age?: number
          spouse_cpp_years_worked?: number
          spouse_income?: number
          spouse_lira?: number
          spouse_nonreg?: number
          spouse_oas_start_age?: number
          spouse_oas_years_in_canada?: number
          spouse_retirement_age?: number | null
          spouse_rrsp?: number
          spouse_tfsa?: number
          target_retirement_age?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          environment: string
          id: string
          price_id: string | null
          product_id: string | null
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          price_id?: string | null
          product_id?: string | null
          status?: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          price_id?: string | null
          product_id?: string | null
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          account_id: string
          amount: number | null
          created_at: string
          currency: string
          fee: number
          fx_rate: number
          holding_id: string | null
          id: string
          notes: string | null
          price_per_unit: number
          transaction_date: string
          transaction_type: string
          units: number
          user_id: string
        }
        Insert: {
          account_id: string
          amount?: number | null
          created_at?: string
          currency?: string
          fee?: number
          fx_rate?: number
          holding_id?: string | null
          id?: string
          notes?: string | null
          price_per_unit?: number
          transaction_date?: string
          transaction_type: string
          units?: number
          user_id: string
        }
        Update: {
          account_id?: string
          amount?: number | null
          created_at?: string
          currency?: string
          fee?: number
          fx_rate?: number
          holding_id?: string | null
          id?: string
          notes?: string | null
          price_per_unit?: number
          transaction_date?: string
          transaction_type?: string
          units?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_holding_id_fkey"
            columns: ["holding_id"]
            isOneToOne: false
            referencedRelation: "holdings"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      plan_state: { Args: { _user_id: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
