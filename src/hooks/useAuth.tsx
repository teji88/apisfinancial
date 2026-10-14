import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (cancelled) return;
      setSession(next);
      setLoading(false);
    });
    // Safety: never leave auth stuck on loading if getSession never settles
    // (same never-resolve/never-reject hang as the profile query).
    const timer = setTimeout(() => {
      if (!cancelled) setLoading(false);
    }, 10_000);
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setLoading(false);
      clearTimeout(timer);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  return { session, user: (session?.user ?? null) as User | null, loading };
}
