import { createFileRoute, Link } from "@tanstack/react-router";

import { ApisLogo } from "@/components/brand/ApisLogo";
import { BenchmarkSimulator } from "@/components/BenchmarkSimulator";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/beat-xeqt")({
  staticData: { sitemap: true },
  head: () => ({
    meta: [
      { title: "Did I beat XEQT? — free benchmark simulator | Apis Financial" },
      {
        name: "description",
        content:
          "Free tool for Canadian investors: enter up to five holdings and compare their total return against XEQT, ZEQT, VCN and the S&P 500 in Canadian dollars. No sign-in.",
      },
      { property: "og:title", content: "Did I beat XEQT? — free benchmark simulator" },
      {
        property: "og:description",
        content:
          "Compare your holdings against XEQT, ZEQT, VCN and SPY with dividends reinvested, in Canadian dollars. No account needed.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BeatXeqt,
});

function BeatXeqt() {
  return (
    <div className="min-h-screen bg-surface">
      <header className="relative overflow-hidden border-b border-border/60 bg-background">
        <div className="pointer-events-none absolute inset-0 honey-cascade" aria-hidden />
        <div className="pointer-events-none absolute inset-0 hex-mesh hex-cascade" aria-hidden />
        <div className="relative mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4 md:px-6">
          <Link to="/">
            <ApisLogo variant="full" size="sm" />
          </Link>
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

      <main className="mx-auto w-full max-w-6xl px-4 py-10 md:px-6 md:py-14">
        <BenchmarkSimulator />
        <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-muted-foreground">
          Prices come from our own Canadian and US market history library, so the comparison is fast
          and every ticker someone tries stays saved for the next person.
        </p>
      </main>
    </div>
  );
}
