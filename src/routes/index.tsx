import { postLoginPath } from "@/lib/pending-plan";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  BarChart3,
  Check,
  Coins,
  FileUp,
  Landmark,
  LayoutDashboard,
  Receipt,
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

function Landing() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && session) void navigate({ to: postLoginPath() });
  }, [loading, session, navigate]);

  return (
    <div className="min-h-screen bg-surface">
      <header className="relative overflow-hidden border-b border-border/60 bg-background">
        <div className="pointer-events-none absolute inset-0 honey-cascade" aria-hidden />
        <div className="pointer-events-none absolute inset-0 hex-mesh hex-cascade" aria-hidden />
        <div className="relative mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 md:px-6">
          <ApisLogo variant="full" size="sm" />

          <div className="flex items-center gap-2">
            <Button asChild size="sm" className="honey-fill">
              <Link to="/retirement">Retirement planner</Link>
            </Button>
            <Button asChild size="sm" className="honey-fill">
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
            <div className="mx-auto mb-3 h-24 w-52" aria-label="A small bee moving between honeycomb cells">
              <div className="honey-flight" aria-hidden="true">
                <span className="honey-cell honey-cell-one" />
                <span className="honey-cell honey-cell-two" />
                <span className="honey-cell honey-cell-three honey-cell-filled" />
                <span className="honey-bee">🐝</span>
              </div>
            </div>
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
                <Link to="/auth">Get started free</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-accent/50">
                <Link to="/retirement">Try the free retirement planner</Link>
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              No card needed. Everything is free — only PDF and screenshot reading is $10 a year.
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

        <section id="pricing" className="mx-auto w-full max-w-6xl px-4 py-16 md:px-6">
          <h2 className="text-center font-display text-3xl font-semibold">Simple pricing</h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-sm text-muted-foreground">
            Everything is free. The only paid extra is having PDF statements and screenshots read
            for you.
          </p>
          <div className="mx-auto mt-10 grid max-w-3xl gap-5 md:grid-cols-2">
            <div className="honey-card p-6">
              <h3 className="text-lg font-semibold">Free</h3>
              <p className="num mt-2 text-3xl font-semibold">$0</p>
              <p className="mt-1 text-xs text-muted-foreground">Forever</p>
              <ul className="mt-5 space-y-2 text-sm">
                {[
                  "Unlimited accounts, holdings and transactions",
                  "Ledger, dividends, performance and benchmarking",
                  "The full retirement planner",
                  "CSV imports",
                ].map((p) => (
                  <li key={p} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    {p}
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-6 w-full border-accent/50" variant="outline">
                <Link to="/auth">Create a free account</Link>
              </Button>
            </div>
            <div className="honey-card border-accent/60 p-6 ring-1 ring-accent/30">
              <h3 className="text-lg font-semibold">Statement reading</h3>
              <p className="num mt-2 text-3xl font-semibold">
                $10<span className="text-base font-normal text-muted-foreground">/year</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Optional · cancel any time</p>
              <ul className="mt-5 space-y-2 text-sm">
                {[
                  "Everything in Free",
                  "Upload PDF statements and screenshots",
                  "Transactions drafted for you to check",
                ].map((p) => (
                  <li key={p} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    {p}
                  </li>
                ))}
              </ul>
              <Button asChild className="honey-fill mt-6 w-full">
                <Link to="/auth">Get started</Link>
              </Button>
            </div>
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
