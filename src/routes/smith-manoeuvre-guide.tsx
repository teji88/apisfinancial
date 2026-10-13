import { createFileRoute, Link } from "@tanstack/react-router";

import { ApisLogo } from "@/components/brand/ApisLogo";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/smith-manoeuvre-guide")({
  staticData: { sitemap: true },
  head: () => ({
    links: [
      {
        rel: "canonical",
        href: "https://www.apisfinancial.app/smith-manoeuvre-guide",
      },
    ],
    meta: [
      {
        title:
          "The Smith Manoeuvre: Canadian guide to tax-deductible mortgage interest | Apis Financial",
      },
      {
        name: "description",
        content:
          "How the Smith Manoeuvre works in Canada: readvanceable mortgage plus HELOC, re-borrowed principal invested for deductible interest under ITA 20(1)(c), CRA tracing rules, risks, and how to track it.",
      },
      {
        property: "og:title",
        content: "The Smith Manoeuvre: Canadian guide to tax-deductible mortgage interest",
      },
      {
        property: "og:description",
        content:
          "What the Smith Manoeuvre is, how the debt conversion works, the tax rules that make the interest deductible, the risks, and how Apis Financial tracks it.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Article",
          headline:
            "The Smith Manoeuvre: Canadian guide to tax-deductible mortgage interest",
          description:
            "How the Smith Manoeuvre works in Canada: readvanceable mortgage plus HELOC, re-borrowed principal invested for deductible interest under ITA 20(1)(c), CRA tracing rules, and risks.",
          author: { "@type": "Organization", name: "Apis Financial" },
          publisher: { "@type": "Organization", name: "Apis Financial" },
        }),
      },
    ],
  }),
  component: SmithManoeuvreGuide,
});

const STEPS = [
  {
    title: "Get a readvanceable mortgage",
    body: "The strategy needs a mortgage paired with a home equity line of credit (HELOC) where every dollar of principal you repay becomes new HELOC room. Not all mortgages do this — the readvanceable feature is the engine.",
  },
  {
    title: "Make your mortgage payments as usual",
    body: "Each payment splits into interest and principal. The principal portion is what creates new re-borrowable room on the HELOC side.",
  },
  {
    title: "Re-borrow the new room and invest it",
    body: "Draw the newly available HELOC room and invest it in a non-registered account — one expected to produce income. This is the step that makes the interest deductible: borrowed money used to earn investment income.",
  },
  {
    title: "Deduct the interest, repeat",
    body: "The HELOC interest is claimed on line 22100 of your tax return. Many people use the tax savings to prepay the mortgage, which creates more room faster. Over years, non-deductible mortgage debt converts into deductible investment debt.",
  },
];

const FAQS = [
  {
    q: "Is mortgage interest tax-deductible in Canada?",
    a: "Interest on your principal-residence mortgage is not deductible. But interest on borrowed money used to earn income from a business or investment generally is deductible under paragraph 20(1)(c) of the Income Tax Act. The Smith Manoeuvre is a systematic way to shift borrowing from the non-deductible category to the deductible one.",
  },
  {
    q: "What does the CRA require for the interest to stay deductible?",
    a: "Tracing: you must be able to show the borrowed money was used for an eligible purpose, and keep it that way. CRA Folio S3-F6-C1 sets out the direct-use test — if borrowed funds are mixed with personal money or the investments are sold and the proceeds spent personally, deductibility can be lost. Keep per-draw records.",
  },
  {
    q: "Can I invest the borrowed money in my TFSA or RRSP?",
    a: "You can, but the interest won't be deductible — registered accounts don't produce the taxable investment income the deduction requires. The strategy is built around non-registered investing.",
  },
  {
    q: "What are the risks?",
    a: "Leverage magnifies losses as well as gains — you're investing with borrowed money secured against your home. Rising HELOC rates increase carrying costs, and if investments are sold at a loss or the money's use changes, the interest deduction can be challenged. This is not a set-and-forget strategy.",
  },
];

function SmithManoeuvreGuide() {
  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-border/60 bg-background">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between px-4 py-4 md:px-6">
          <Link to="/">
            <ApisLogo variant="full" size="sm" />
          </Link>
          <Button asChild size="sm" className="honey-fill">
            <Link to="/auth">Get started free</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl px-4 py-12 md:px-6 md:py-16">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
          Canadian investor guide
        </p>
        <h1 className="mt-3 font-display text-4xl font-semibold leading-tight md:text-5xl">
          The Smith Manoeuvre: making mortgage interest tax-deductible in Canada
        </h1>
        <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground">
          The Smith Manoeuvre is a Canadian debt-conversion strategy, developed
          by financial planner Fraser Smith, that gradually turns
          non-deductible mortgage debt into tax-deductible investment debt.
          This guide explains how it works, the tax rules behind it, and the
          risks — and how Apis Financial&apos;s HELOC investing tracker keeps
          the records straight.
        </p>

        <section className="mt-12">
          <h2 className="font-display text-2xl font-semibold">How it works</h2>
          <div className="mt-6 space-y-4">
            {STEPS.map((s, i) => (
              <div key={s.title} className="honey-card p-5">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">
                  Step {i + 1}
                </p>
                <h3 className="mt-1.5 text-base font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12">
          <h2 className="font-display text-2xl font-semibold">
            The tax rules that make it work
          </h2>
          <div className="mt-4 space-y-4 text-sm leading-6 text-muted-foreground">
            <p>
              The deduction rests on paragraph 20(1)(c) of the Income Tax Act:
              interest is deductible when borrowed money is used for the
              purpose of earning income from a business or property. Courts
              from Ludco to Singleton have confirmed it is the{" "}
              <em>use</em> of the borrowed money — not what secures the loan —
              that matters. A HELOC secured by your home still qualifies if
              the drawn funds buy income-producing investments.
            </p>
            <p>
              The CRA applies a direct-use tracing test (Folio S3-F6-C1). Each
              draw is its own loan for tax purposes: keep records of when you
              drew, how much, what it bought, and where any distributions
              went. Commingling borrowed money with personal cash, or
              redirecting proceeds to personal spending, can taint
              deductibility.
            </p>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="font-display text-2xl font-semibold">
            Tracking it with Apis Financial
          </h2>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            The HELOC investing tracker in Apis Financial is built around the
            records this strategy demands: your readvanceable mortgage and
            HELOC as a linked pair, room created as principal is repaid,
            every draw as a separate traceable tranche, deductible interest
            totals for line 22100, and the investment performance behind the
            borrowed money. The tracker is free — every draw, tranche and tax record.
            Only AI statement reading is Pro ($10/year).
          </p>
          <Button asChild size="lg" className="honey-fill mt-6">
            <Link to="/auth">Start free</Link>
          </Button>
        </section>

        <section className="mt-12">
          <h2 className="font-display text-2xl font-semibold">
            Common questions
          </h2>
          <div className="mt-6 space-y-3">
            {FAQS.map((f) => (
              <details
                key={f.q}
                className="honey-card group px-5 py-4 [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="cursor-pointer text-sm font-semibold list-none">
                  {f.q}
                </summary>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {f.a}
                </p>
              </details>
            ))}
          </div>
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "FAQPage",
                mainEntity: FAQS.map((f) => ({
                  "@type": "Question",
                  name: f.q,
                  acceptedAnswer: { "@type": "Answer", text: f.a },
                })),
              }),
            }}
          />
        </section>

        <p className="mt-12 rounded-lg border border-border/60 bg-background/40 p-4 text-xs leading-5 text-muted-foreground">
          <strong className="text-foreground">Information only.</strong> This
          guide is for general information and is not financial, investment or
          tax advice. Tax rules are complex and individual circumstances vary
          — verify everything yourself and consider a qualified professional
          before acting. &ldquo;Smith Manoeuvre&rdquo; is a trademark of Smith
          Consulting Group Ltd.; this page refers to the strategy
          descriptively and is not affiliated with or endorsed by the
          trademark owner.
        </p>
      </main>

      <footer className="border-t border-border/60">
        <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-muted-foreground md:px-6">
          <span>© {new Date().getFullYear()} Apis Financial</span>
          <span>Information only — not financial or tax advice.</span>
        </div>
      </footer>
    </div>
  );
}
