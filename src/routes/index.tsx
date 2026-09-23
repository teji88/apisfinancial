import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  BarChart3,
  Check,
  Coins,
  FileUp,
  Gift,
  Landmark,
  LayoutDashboard,
  Minus,
  Receipt,
  Sparkles,
} from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { ApisLogo } from "@/components/brand/ApisLogo";
import { BenchmarkSimulator } from "@/components/BenchmarkSimulator";

import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  staticData: { sitemap: true },
  head: () => ({
    meta: [
      { title: "Apis Financial — Canadian portfolio tracker & retirement planner" },
      {
        name: "description",
        content:
          "Track TFSA, RRSP, FHSA and non-registered investments in CAD, follow dividend income, benchmark your returns and plan retirement with tax-efficient withdrawals.",
      },
      {
        property: "og:title",
        content: "Apis Financial — Canadian portfolio tracker & retirement planner",
      },
      {
        property: "og:description",
        content:
          "One place for Canadian accounts, adjusted cost base, dividends, benchmarking and a retirement plan in today's dollars.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  {
    icon: LayoutDashboard,
    title: "Every Canadian account type",
    body: "TFSA, RRSP, Spousal RRSP, LIRA/LRSP, RESP, RDSP, FHSA, non-registered and corporate — held in CAD or USD, totalled in Canadian dollars.",
  },
  {
    icon: Receipt,
    title: "A ledger that does the math",
    body: "Adjusted cost base on every purchase, realized gains on every sale, plus money-weighted and time-weighted returns.",
  },
  {
    icon: Coins,
    title: "Dividend income tracking",
    body: "Forward annual income, portfolio yield, yield on cost, twelve months of payments received and a ten-year compounding projection.",
  },
  {
    icon: BarChart3,
    title: "Honest benchmarking",
    body: "Compare against the S&P 500, the TSX Composite or a global all-equity fund using your exact deposit dates and amounts.",
  },
  {
    icon: Landmark,
    title: "Retirement planning in today's dollars",
    body: "CPP and OAS from your own earnings history, forced RRIF and LIF minimums, clawback protection and a year-by-year withdrawal plan.",
  },
  {
    icon: FileUp,
    title: "Statement reading",
    body: "Drop a statement, CSV or screenshot and have the transactions drafted for you to check before anything is saved.",
  },
];

const COMPARISON: Array<{
  label: string;
  free: string | boolean;
  pro: string | boolean;
  plus: string | boolean;
}> = [
  { label: "Accounts", free: "1", pro: "Unlimited", plus: "Unlimited" },
  { label: "Holdings", free: "10", pro: "Unlimited", plus: "Unlimited" },
  { label: "Ledger, adjusted cost base and returns", free: true, pro: true, plus: true },
  { label: "Dividends and the ten-year compounder", free: true, pro: true, plus: true },
  { label: "Benchmarking", free: true, pro: true, plus: true },
  { label: "Retirement plan and withdrawal schedule", free: true, pro: true, plus: true },
  { label: "All accounts combined vs benchmarks", free: false, pro: true, plus: true },
  { label: "Upload a statement for AI reading", free: false, pro: true, plus: true },
  { label: "Change retirement age, CPP and OAS start dates", free: false, pro: true, plus: true },
  { label: "Change inflation, growth and life expectancy", free: false, pro: true, plus: true },
  { label: "Couple and household planning", free: false, pro: false, plus: true },
  { label: "Savings split and what-if balances", free: false, pro: false, plus: true },
];

function Landing() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && session) void navigate({ to: "/dashboard" });
  }, [loading, session, navigate]);

  return (
    <div className="min-h-screen bg-surface">
      <header className="relative overflow-hidden border-b border-border/60 bg-background">
        <div className="pointer-events-none absolute inset-0 honey-cascade" aria-hidden />
        <div className="pointer-events-none absolute inset-0 hex-mesh hex-cascade" aria-hidden />
        <div className="relative mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 md:px-6">
          <ApisLogo variant="full" size="sm" />

          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/auth">Sign in</Link>
            </Button>
            <Button asChild size="sm" className="honey-fill">
              <Link to="/auth">Get started</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden">
          <div className="relative mx-auto w-full max-w-6xl px-4 py-16 text-center md:px-6 md:py-24">
            <p className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/15 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-primary">
              Built for Canadian investors
            </p>
            <h1 className="mx-auto mt-4 max-w-3xl font-display text-4xl font-semibold leading-tight md:text-5xl">
              Know what you own, what it earns, and when you can retire
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground">
              Apis Financial tracks your registered and non-registered accounts in Canadian dollars,
              follows your dividend income, measures you against the market, and turns it all into a
              retirement plan that keeps tax and OAS clawback as low as possible.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild size="lg" className="honey-fill">
                <Link to="/auth">Start your 30-day free trial</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-accent/50">
                <a href="#pricing">See pricing</a>
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Every feature free for 30 days — no card needed. After that, the free plan keeps one
              account and ten holdings.
            </p>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pb-4 md:px-6">
          <BenchmarkSimulator />
        </section>

        <section className="border-y border-border/60 bg-background/40">
          <div className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-16 md:grid-cols-3 md:px-6">
            {FEATURES.map((f) => (
              <div key={f.title} className="honey-card p-5">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/25 text-primary ring-1 ring-accent/40">
                  <f.icon className="h-5 w-5" />
                </span>
                <h3 className="mt-3 text-base font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 py-14 md:px-6">
          <div className="grid gap-5 md:grid-cols-2">
            <div className="honey-card p-6">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/25 text-primary ring-1 ring-accent/40">
                <Sparkles className="h-5 w-5" />
              </span>
              <h3 className="mt-3 font-display text-xl font-semibold">
                30 days of everything, free
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Every new account starts with a full 30-day trial: unlimited accounts and holdings,
                statement uploads, combined benchmarking and the complete household retirement
                planner. No card, no commitment — if you do nothing when it ends, you simply move to
                the free plan and keep your data.
              </p>
              <Button asChild className="honey-fill mt-5">
                <Link to="/auth">Start the free trial</Link>
              </Button>
            </div>

            <div className="honey-card p-6">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/25 text-primary ring-1 ring-accent/40">
                <Gift className="h-5 w-5" />
              </span>
              <h3 className="mt-3 font-display text-xl font-semibold">
                Refer a friend, get a year free
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Share your personal invite link from inside the app. When a friend who joins through
                it picks a yearly plan — $10 Pro or $20 Pro+ — you get a full year of that same plan
                at no charge. Refer three friends, get three years. There is no limit.
              </p>
              <Button asChild variant="outline" className="mt-5 border-accent/50">
                <Link to="/auth">Create your invite link</Link>
              </Button>
            </div>
          </div>
        </section>

        <section id="pricing" className="mx-auto w-full max-w-6xl px-4 py-16 md:px-6">
          <h2 className="text-center font-display text-3xl font-semibold">Simple pricing</h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm text-muted-foreground">
            Start free and stay free for a single account. Pro removes every limit, and Pro+ adds
            household planning — all for about the price of a coffee a year.
          </p>

          <div className="mx-auto mt-10 grid max-w-5xl gap-5 md:grid-cols-3">
            <div className="honey-card p-6">
              <h3 className="text-lg font-semibold">Free</h3>
              <p className="num mt-2 text-3xl font-semibold">$0</p>
              <p className="mt-1 text-xs text-muted-foreground">Forever</p>
              <ul className="mt-5 space-y-2 text-sm">
                {[
                  "One account",
                  "Up to ten holdings",
                  "Ledger, dividends, performance",
                  "Retirement plan with standard assumptions",
                  "Type transactions in by hand",
                ].map((p) => (
                  <li key={p} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    {p}
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-6 w-full border-accent/50" variant="outline">
                <Link to="/auth">Create an account</Link>
              </Button>
            </div>

            <div className="honey-card relative overflow-hidden border-accent/60 p-6 ring-1 ring-accent/30">
              <div className="relative flex items-center justify-between">
                <h3 className="text-lg font-semibold">Pro</h3>
                <span className="rounded-full bg-accent/25 px-2.5 py-1 text-xs font-medium text-primary ring-1 ring-accent/40">
                  Most useful
                </span>
              </div>

              <p className="num relative mt-2 text-3xl font-semibold">
                $1<span className="text-base font-normal text-muted-foreground">/month</span>
              </p>
              <p className="relative mt-1 text-xs text-muted-foreground">
                or $10 a year · cancel any time
              </p>
              <ul className="relative mt-5 space-y-2 text-sm">
                {[
                  "Everything in Free",
                  "Unlimited accounts and holdings",
                  "Upload statements for AI reading",
                  "All accounts combined vs benchmarks",
                  "Your own retirement age, CPP and OAS start",
                  "Your own inflation, growth and life expectancy",
                ].map((p) => (
                  <li key={p} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    {p}
                  </li>
                ))}
              </ul>
              <Button asChild className="honey-fill relative mt-6 w-full">
                <Link to="/auth">Get Pro</Link>
              </Button>
            </div>

            <div className="honey-card p-6">
              <h3 className="text-lg font-semibold">Pro+</h3>
              <p className="num mt-2 text-3xl font-semibold">
                $2<span className="text-base font-normal text-muted-foreground">/month</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">or $20 a year · cancel any time</p>
              <ul className="mt-5 space-y-2 text-sm">
                {[
                  "Everything in Pro",
                  "Couple and household planning",
                  "Spouse CPP, OAS and balances",
                  "Pension splitting and clawback control",
                  "Savings split and what-if balances",
                ].map((p) => (
                  <li key={p} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    {p}
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-6 w-full border-accent/50" variant="outline">
                <Link to="/auth">Get Pro+</Link>
              </Button>
            </div>
          </div>

          <div className="honey-card mt-12 overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left">
                  <th className="px-5 py-3 font-medium">What you get</th>
                  <th className="px-5 py-3 text-center font-medium">Free</th>
                  <th className="px-5 py-3 text-center font-medium">Pro</th>
                  <th className="px-5 py-3 text-center font-medium">Pro+</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row) => (
                  <tr key={row.label} className="border-b border-border/40 last:border-0">
                    <td className="px-5 py-3">{row.label}</td>
                    <td className="px-5 py-3 text-center">
                      <Cellv value={row.free} />
                    </td>
                    <td className="px-5 py-3 text-center">
                      <Cellv value={row.pro} />
                    </td>
                    <td className="px-5 py-3 text-center">
                      <Cellv value={row.plus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="border-t border-border/60 bg-background/40">
          <div className="mx-auto w-full max-w-3xl px-4 py-16 text-center md:px-6">
            <h2 className="font-display text-3xl font-semibold">
              See your retirement date, not just your balance
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Add your accounts and Apis Financial does the rest — in today&apos;s dollars, with
              Canadian tax rules built in.
            </p>
            <Button asChild size="lg" className="honey-fill mt-7">
              <Link to="/auth">Start free</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-muted-foreground md:px-6">
          <span>© {new Date().getFullYear()} Apis Financial</span>
          <span>Information only — not financial or tax advice.</span>
        </div>
      </footer>
    </div>
  );
}

function Cellv({ value }: { value: string | boolean }) {
  if (value === true) return <Check className="mx-auto h-4 w-4 text-accent" />;
  if (value === false) return <Minus className="mx-auto h-4 w-4 text-muted-foreground" />;
  return <span className="num">{value}</span>;
}
