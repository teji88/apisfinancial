/**
 * MapleWealth retirement engine (household edition).
 * Engine 1: forward projection → earliest sustainable retirement age.
 * Engine 2: tax-efficient drawdown with RRSP/LIF melt-down to pre-empt the
 *           age-71 forced-withdrawal spike and OAS clawback.
 * All amounts are nominal CAD unless stated otherwise.
 */

import { computeTax, FED_AGE_CLAWBACK_END, type ProvinceCode } from "./tax";

/** Annual TFSA contribution room (2026), used when sweeping surplus cash. */
export const TFSA_ANNUAL_ROOM = 7_000;

/**
 * The lowest income cliff worth respecting in a given year: the OAS clawback
 * threshold, and — from 65 — the age-amount credit clawback ceiling, which
 * bites first. `tolerance` allows a deliberate, bounded overshoot.
 */
export function effectiveCeiling(age: number, tolerance = 0): number {
  const caps = [OAS_CLAWBACK_THRESHOLD];
  if (age >= 65) caps.push(FED_AGE_CLAWBACK_END);
  return Math.min(...caps) + Math.max(0, tolerance);
}

/* ---------------------------------- CPP / OAS --------------------------------- */

/** 2026 maximum CPP at 65: $18,091/year. */
export const CPP_MAX_ANNUAL_65 = 18_091;
export const CPP_MAX_MONTHLY_65 = CPP_MAX_ANNUAL_65 / 12;
/** 2026 maximum OAS at 65: $8,732/year. */
export const OAS_MAX_ANNUAL_65 = 8_732;
export const OAS_MAX_MONTHLY_65 = OAS_MAX_ANNUAL_65 / 12;
export const OAS_CLAWBACK_THRESHOLD = 95_323;
export const OAS_CLAWBACK_RATE = 0.15;

/** Inflation-stripped growth rate: everything in the plan is modelled in 2026 dollars. */
export function realReturn(nominalPct: number, inflationPct: number): number {
  return (1 + nominalPct / 100) / (1 + inflationPct / 100) - 1;
}
/** Year's maximum pensionable earnings (2026 estimate). */
export const YMPE = 71_300;
/** Contributory years counted after the 17% general drop-out. */
export const CPP_QUALIFYING_YEARS = 39;

export type EarningsHistory = {
  /** Typical annual employment income earned so far, in today's dollars. */
  pastAverageIncome: number;
  /** Number of years worked with CPP contributions so far. */
  yearsWorked: number;
  /** Expected annual employment income from now until retirement, today's dollars. */
  futureIncome: number;
  /** Years remaining of contributions (age → retirement age, capped at 65). */
  futureYears: number;
};

/** Share of the CPP maximum (0–100) implied by an earnings history. */
export function cppPercentFromEarnings(h: EarningsHistory): number {
  const ratio = (income: number) => Math.min(1, Math.max(0, income) / YMPE);
  const past = Math.max(0, h.yearsWorked) * ratio(h.pastAverageIncome);
  const future = Math.max(0, h.futureYears) * ratio(h.futureIncome);
  const credited = Math.min(CPP_QUALIFYING_YEARS, past + future);
  return Math.round((credited / CPP_QUALIFYING_YEARS) * 1000) / 10;
}

/** Annual CPP in today's dollars for a given share of the maximum and start age. */
export function cppAt(startAge: number, pctOfMax: number): number {
  const base = CPP_MAX_MONTHLY_65 * 12 * (pctOfMax / 100);
  if (startAge < 65) return base * (1 - 0.006 * (65 - startAge) * 12);
  if (startAge > 65) return base * (1 + 0.0084 * Math.min(60, (startAge - 65) * 12));
  return base;
}

/** Share of full OAS (0–1) from years of Canadian residence after age 18. */
export function oasFractionFromResidence(years: number): number {
  return Math.min(1, Math.max(0, years) / 40);
}

/** Annual OAS at the chosen start age, today's dollars, before clawback. */
export function oasAt(startAge: number, fraction = 1): number {
  const base = OAS_MAX_MONTHLY_65 * 12 * Math.min(1, Math.max(0, fraction));
  const months = Math.min(60, Math.max(0, (startAge - 65) * 12));
  return base * (1 + 0.006 * months);
}

export function oasClawback(netIncome: number, oasReceived: number, threshold: number): number {
  if (netIncome <= threshold) return 0;
  return Math.min(oasReceived, (netIncome - threshold) * OAS_CLAWBACK_RATE);
}

/* ------------------------------- RRIF / LIF ----------------------------------- */

const RRIF_MIN: Record<number, number> = {
  71: 0.0528, 72: 0.054, 73: 0.0553, 74: 0.0567, 75: 0.0582, 76: 0.0598,
  77: 0.0617, 78: 0.0636, 79: 0.0658, 80: 0.0682, 81: 0.0708, 82: 0.0738,
  83: 0.0771, 84: 0.0808, 85: 0.0851, 86: 0.0899, 87: 0.0955, 88: 0.1021,
  89: 0.1099, 90: 0.1192, 91: 0.1306, 92: 0.1449, 93: 0.1634, 94: 0.1879,
};

const LIF_MAX: Record<number, number> = {
  71: 0.0738, 72: 0.0752, 73: 0.0767, 74: 0.0782, 75: 0.0798, 76: 0.0815,
  77: 0.0833, 78: 0.0853, 79: 0.0875, 80: 0.0899, 81: 0.0927, 82: 0.0958,
  83: 0.0993, 84: 0.1033, 85: 0.1079, 86: 0.1133, 87: 0.1196, 88: 0.1271,
  89: 0.1362, 90: 0.1473, 91: 0.1612, 92: 0.1792, 93: 0.2035, 94: 0.2381,
};

export function rrifMinFactor(age: number): number {
  if (age >= 95) return 0.2;
  if (age >= 71) return RRIF_MIN[age] ?? 0.2;
  return 1 / (90 - age);
}

export function lifMaxFactor(age: number): number {
  if (age >= 95) return 1;
  if (age >= 71) return LIF_MAX[age] ?? 1;
  return 1 / (90 - age) + 0.02;
}

/* --------------------------------- Inputs ------------------------------------ */

export type PersonSpec = {
  label: string;
  age: number;
  retirementAge: number;
  cppStartAge: number;
  /** Annual CPP at 65 in today's dollars. */
  cppAt65: number;
  oasStartAge: number;
  /** Share of full OAS, 0–1, from years of residence. */
  oasFraction: number;
  /** Other taxable retirement income (pension, rental…), today's dollars. */
  otherIncome: number;
  balances: { tfsa: number; rrsp: number; lira: number; nonreg: number };
  /** Share of the non-registered balance that is unrealized gain. */
  nonregGainRatio: number;
};

export type SavingsSplit = { tfsa: number; rrsp: number; nonreg: number };

export type PlannerInputs = {
  retirementAge: number; // primary person's retirement age (the plan start)
  lifeExpectancy: number;
  province: ProvinceCode;
  inflation: number; // %
  growth: number; // %
  desiredIncome: number; // household after-tax, today's CAD
  annualSavings: number; // today's CAD per year until retirement
  savingsSplit: SavingsSplit; // percentages, normalised internally
  /** Bounded income overshoot above the effective ceiling allowed when a
   *  melt-down lookahead shows deferring only relocates the tax bill. */
  clawbackTolerance?: number;
  self: PersonSpec;
  spouse: PersonSpec | null;
};

export type PersonYear = {
  label: string;
  age: number;
  rrifDraw: number;
  lifDraw: number;
  nonregDraw: number;
  tfsaDraw: number;
  cpp: number;
  oas: number;
  oasClawback: number;
  otherIncome: number;
  taxableIncome: number;
  taxes: number;
  balances: { tfsa: number; rrsp: number; lira: number; nonreg: number; total: number };
};

export type YearRow = {
  age: number; // primary person's age
  year: number;
  rrifDraw: number;
  lifDraw: number;
  nonregDraw: number;
  tfsaDraw: number;
  cpp: number;
  oas: number; // net of clawback
  oasClawback: number;
  otherIncome: number;
  taxes: number;
  spending: number;
  shortfall: number;
  pensionSplit: number;
  /** Lowest income cliff respected this year (household lowest). */
  effectiveCeiling: number;
  /** True when future forced RRIF/LIF minimums will breach the ceiling anyway. */
  meltdownFlag: boolean;
  people: PersonYear[];
  balances: { tfsa: number; rrsp: number; lira: number; nonreg: number; total: number };
};

export type Projection = {
  rows: YearRow[];
  depletionAge: number | null;
  success: boolean;
  endingBalance: number;
  totalTaxes: number;
  totalClawback: number;
  /** Deferred tax on registered money left at death (100% income that year). */
  estateTax: number;
  /** Registered balance remaining at life expectancy. */
  estateRegistered: number;
};

/* --------------------------------- Helpers ------------------------------------ */

function bisect(f: (x: number) => number, lo: number, hi: number): number {
  if (hi <= lo) return lo;
  if (f(hi) < 0) return hi;
  if (f(lo) > 0) return lo;
  let a = lo;
  let b = hi;
  for (let i = 0; i < 50; i += 1) {
    const m = (a + b) / 2;
    if (f(m) < 0) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

type PersonState = {
  spec: PersonSpec;
  tfsa: number;
  rrsp: number;
  lira: number;
  nonreg: number;
  acb: number;
};

type Draw = { reg: number; lif: number; nonreg: number; tfsa: number };

const zeroDraw = (): Draw => ({ reg: 0, lif: 0, nonreg: 0, tfsa: 0 });

/* -------------------------------- Projection ---------------------------------- */

export function projectRetirement(input: PlannerInputs): Projection {
  // Real-dollar engine: balances grow at the inflation-stripped return and every
  // spending need, tax bracket, CPP/OAS amount and clawback line stays at 2026 values.
  const growth = realReturn(input.growth, input.inflation);
  const thisYear = new Date().getUTCFullYear();

  const specs: PersonSpec[] = input.spouse ? [input.self, input.spouse] : [input.self];
  const people: PersonState[] = specs.map((spec) => ({
    spec,
    tfsa: spec.balances.tfsa,
    rrsp: spec.balances.rrsp,
    lira: spec.balances.lira,
    nonreg: spec.balances.nonreg,
    acb: spec.balances.nonreg * (1 - spec.nonregGainRatio),
  }));

  const startAge = input.self.age;
  const retireAge = Math.max(input.retirementAge, startAge);

  // --- Accumulation: savings go to the primary person's accounts by the chosen split.
  const splitTotal =
    Math.max(0, input.savingsSplit.tfsa) +
    Math.max(0, input.savingsSplit.rrsp) +
    Math.max(0, input.savingsSplit.nonreg);
  const share = {
    tfsa: splitTotal > 0 ? Math.max(0, input.savingsSplit.tfsa) / splitTotal : 0.4,
    rrsp: splitTotal > 0 ? Math.max(0, input.savingsSplit.rrsp) / splitTotal : 0.4,
    nonreg: splitTotal > 0 ? Math.max(0, input.savingsSplit.nonreg) / splitTotal : 0.2,
  };
  const primary = people[0]!;
  for (let age = startAge; age < retireAge; age += 1) {
    const contribution = input.annualSavings;
    primary.tfsa = (primary.tfsa + contribution * share.tfsa) * (1 + growth);
    primary.rrsp = (primary.rrsp + contribution * share.rrsp) * (1 + growth);
    primary.acb += contribution * share.nonreg;
    primary.nonreg = (primary.nonreg + contribution * share.nonreg) * (1 + growth);
    primary.lira *= 1 + growth;
    for (const p of people.slice(1)) {
      p.tfsa *= 1 + growth;
      p.rrsp *= 1 + growth;
      p.lira *= 1 + growth;
      p.nonreg *= 1 + growth;
    }
  }

  const rows: YearRow[] = [];
  /** Unused TFSA contribution room per person, grown each year. */
  const tfsaRoom = people.map(() => 0);
  let depletionAge: number | null = null;
  let totalTaxes = 0;
  let totalClawback = 0;

  for (let age = retireAge; age <= input.lifeExpectancy; age += 1) {
    const yearsFromNow = age - startAge;
    const need = input.desiredIncome;
    const clawThreshold = OAS_CLAWBACK_THRESHOLD;

    const ages = people.map((p) => p.spec.age + (age - startAge));
    const cpp = people.map((p, i) => (ages[i]! >= p.spec.cppStartAge ? adjustedCpp(p.spec) : 0));
    const oasGross = people.map((p, i) =>
      ages[i]! >= Math.max(65, p.spec.oasStartAge)
        ? oasAt(p.spec.oasStartAge, p.spec.oasFraction)
        : 0,
    );
    const other = people.map((p, i) =>
      ages[i]! >= p.spec.retirementAge ? p.spec.otherIncome : 0,
    );

    // Step 4a — melt-down lookahead. Roll each person's registered money forward
    // at the real growth rate with only the mandatory minimums coming out. If a
    // future year's forced income breaches the ceiling regardless, the tax bill is
    // merely being relocated: flag it and allow the bounded tolerance overshoot.
    const tolerance = Math.max(0, input.clawbackTolerance ?? 0);
    const meltdown = people.map((p, i) => {
      let rrsp = p.rrsp;
      let lira = p.lira;
      const baseFixed = cpp[i]! + oasGross[i]! + other[i]!;
      for (let a = ages[i]!; a <= input.lifeExpectancy; a += 1) {
        const forced = a >= 71 ? (rrsp + lira) * rrifMinFactor(a) : 0;
        if (baseFixed + forced > effectiveCeiling(a)) return true;
        if (a >= 71) {
          const f = rrifMinFactor(a);
          rrsp -= rrsp * f;
          lira -= lira * f;
        }
        rrsp *= 1 + growth;
        lira *= 1 + growth;
      }
      return false;
    });
    const ceilings = people.map((_, i) =>
      effectiveCeiling(ages[i]!, meltdown[i] ? tolerance : 0),
    );


    /** Household tax for a set of draws, choosing the best pension split. */
    const evaluate = (draws: Draw[]) => {
      const pension = people.map((_, i) => draws[i]!.reg + draws[i]!.lif);
      const base = people.map(
        (_, i) => cpp[i]! + oasGross[i]! + other[i]! + pension[i]!,
      );

      let bestSplit = 0;
      let best: ReturnType<typeof scoreSplit> | null = null;
      const canSplit =
        people.length === 2 && ages.some((a) => a >= 65) && pension.some((x) => x > 0);
      const options = canSplit ? [0, 0.1, 0.2, 0.3, 0.4, 0.5] : [0];

      function scoreSplit(fraction: number) {
        // Move eligible pension income from the higher-income person to the lower.
        const hi = base[0]! >= (base[1] ?? -Infinity) ? 0 : 1;
        const lo = hi === 0 ? 1 : 0;
        const eligible = ages[hi]! >= 65 ? pension[hi]! : 0;
        const moved = eligible * fraction;

        let taxes = 0;
        let claw = 0;
        let taxable = 0;
        const perPerson: {
          taxes: number;
          claw: number;
          taxable: number;
        }[] = [];

        for (let i = 0; i < people.length; i += 1) {
          const p = people[i]!;
          const d = draws[i]!;
          const adj = i === hi ? -moved : people.length === 2 && i === lo ? moved : 0;
          const ordinary = base[i]! + adj;
          const gainRatio = p.nonreg > 0 ? Math.max(0, 1 - p.acb / p.nonreg) : 0;
          const gains = d.nonreg * gainRatio;
          const pensionCredit =
            ages[i]! >= 65 ? Math.max(0, pension[i]! + adj) : 0;
          const t = computeTax({
            ordinary,
            capitalGains: gains,
            province: input.province,
            age: ages[i]!,
            pensionIncome: pensionCredit,
          });
          const c = oasClawback(t.netIncome, oasGross[i]!, clawThreshold);
          taxes += t.total + c;
          claw += c;
          taxable += t.taxableIncome;
          perPerson.push({ taxes: t.total + c, claw: c, taxable: t.taxableIncome });
        }
        return { taxes, claw, taxable, perPerson, moved };
      }

      for (const f of options) {
        const s = scoreSplit(f);
        if (!best || s.taxes < best.taxes) {
          best = s;
          bestSplit = f === 0 ? 0 : s.moved;
        }
      }
      const result = best!;
      const cash = people.reduce(
        (sum, _, i) =>
          sum +
          cpp[i]! +
          oasGross[i]! +
          other[i]! +
          draws[i]!.reg +
          draws[i]!.lif +
          draws[i]!.nonreg +
          draws[i]!.tfsa,
        0,
      );
      return { ...result, split: bestSplit, net: cash - result.taxes };
    };

    const draws: Draw[] = people.map(() => zeroDraw());

    // Step 1 — mandatory RRIF / LIF minimums from age 71.
    people.forEach((p, i) => {
      const converted = ages[i]! >= 71;
      draws[i]!.reg = converted ? p.rrsp * rrifMinFactor(ages[i]!) : 0;
      draws[i]!.lif = converted ? p.lira * rrifMinFactor(ages[i]!) : 0;
    });

    let res = evaluate(draws);

    // Step 4 — fill the income gap from registered money, stopping at the
    // effective ceiling (age-amount clawback, then OAS clawback), widened by the
    // tolerance when the lookahead flagged a melt-down. LIF room is
    // use-it-or-lose-it, so locked-in money comes first.
    const regRoom = people.map((p, i) => {
      const baseOrdinary = cpp[i]! + oasGross[i]! + other[i]!;
      const ceiling = Math.max(0, ceilings[i]! - baseOrdinary);
      const lifCap = Math.max(0, Math.min(p.lira, p.lira * lifMaxFactor(ages[i]!)) - draws[i]!.lif);
      const regCap = Math.max(0, p.rrsp - draws[i]!.reg);
      const headroom = Math.max(0, ceiling - draws[i]!.reg - draws[i]!.lif);
      return { lif: Math.min(lifCap, headroom), reg: Math.min(regCap, Math.max(0, headroom - Math.min(lifCap, headroom))) };
    });
    const regTotal = regRoom.reduce((s, r) => s + r.lif + r.reg, 0);
    if (res.net < need && regTotal > 0) {
      const baseline = people.map((_, i) => ({ ...draws[i]! }));
      const apply = (x: number) => {
        const f = x / regTotal;
        people.forEach((_, i) => {
          draws[i]!.lif = baseline[i]!.lif + regRoom[i]!.lif * f;
          draws[i]!.reg = baseline[i]!.reg + regRoom[i]!.reg * f;
        });
      };
      const solved = bisect(
        (x) => {
          apply(x);
          return evaluate(draws).net - need;
        },
        0,
        regTotal,
      );
      apply(solved);
      res = evaluate(draws);
    }

    // Step 3 — still short? non-registered next.
    if (res.net < need) {
      const pool = people.reduce((s, p) => s + p.nonreg, 0);
      if (pool > 0) {
        const apply = (x: number) => {
          people.forEach((p, i) => {
            draws[i]!.nonreg = pool > 0 ? (x * p.nonreg) / pool : 0;
          });
        };
        const solved = bisect(
          (x) => {
            apply(x);
            return evaluate(draws).net - need;
          },
          0,
          pool,
        );
        apply(solved);
        res = evaluate(draws);
      }
    }

    // Step 4 — top up with TFSA (tax-free, invisible to the clawback).
    if (res.net < need) {
      const pool = people.reduce((s, p) => s + p.tfsa, 0);
      if (pool > 0) {
        const want = Math.min(pool, need - res.net);
        people.forEach((p, i) => {
          draws[i]!.tfsa = (want * p.tfsa) / pool;
        });
        res = evaluate(draws);
      }
    }

    // Step 5 — last resort: registered money above the bracket ceiling.
    if (res.net < need) {
      const room = people.reduce(
        (s, p, i) =>
          s +
          Math.max(0, p.rrsp - draws[i]!.reg) +
          Math.max(0, Math.min(p.lira, p.lira * lifMaxFactor(ages[i]!)) - draws[i]!.lif),
        0,
      );
      if (room > 0) {
        const baseline = people.map((_, i) => ({ ...draws[i]! }));
        const apply = (x: number) => {
          const f = room > 0 ? x / room : 0;
          people.forEach((p, i) => {
            const rReg = Math.max(0, p.rrsp - baseline[i]!.reg);
            const rLif = Math.max(
              0,
              Math.min(p.lira, p.lira * lifMaxFactor(ages[i]!)) - baseline[i]!.lif,
            );
            draws[i]!.reg = baseline[i]!.reg + rReg * f;
            draws[i]!.lif = baseline[i]!.lif + rLif * f;
          });
        };
        const solved = bisect(
          (x) => {
            apply(x);
            return evaluate(draws).net - need;
          },
          0,
          room,
        );
        apply(solved);
        res = evaluate(draws);
      }
    }

    const shortfall = Math.max(0, need - res.net);

    // Apply withdrawals, reinvest surplus, then grow.
    const perPerson: PersonYear[] = [];
    let surplus = Math.max(0, res.net - need);
    people.forEach((p, i) => {
      const d = draws[i]!;
      const gainRatio = p.nonreg > 0 ? Math.max(0, 1 - p.acb / p.nonreg) : 0;
      p.acb = Math.max(0, p.acb - d.nonreg * (1 - gainRatio));
      p.rrsp = Math.max(0, p.rrsp - d.reg);
      p.lira = Math.max(0, p.lira - d.lif);
      p.nonreg = Math.max(0, p.nonreg - d.nonreg);
      p.tfsa = Math.max(0, p.tfsa - d.tfsa);
      // Room accrues yearly and withdrawals are added back the following year.
      tfsaRoom[i] = tfsaRoom[i]! + TFSA_ANNUAL_ROOM + d.tfsa;
      if (surplus > 0) {
        // Step 3 — sweep surplus into the TFSA while room lasts, then non-registered.
        const toTfsa = Math.min(surplus, Math.max(0, tfsaRoom[i]!));
        p.tfsa += toTfsa;
        tfsaRoom[i] = tfsaRoom[i]! - toTfsa;
        surplus -= toTfsa;
        if (i === people.length - 1 && surplus > 0) {
          p.nonreg += surplus;
          p.acb += surplus;
          surplus = 0;
        }
      }
      p.rrsp *= 1 + growth;
      p.lira *= 1 + growth;
      p.tfsa *= 1 + growth;
      p.nonreg *= 1 + growth;

      const info = res.perPerson[i]!;
      perPerson.push({
        label: p.spec.label,
        age: ages[i]!,
        rrifDraw: d.reg,
        lifDraw: d.lif,
        nonregDraw: d.nonreg,
        tfsaDraw: d.tfsa,
        cpp: cpp[i]!,
        oas: Math.max(0, oasGross[i]! - info.claw),
        oasClawback: info.claw,
        otherIncome: other[i]!,
        taxableIncome: info.taxable,
        taxes: info.taxes,
        balances: {
          tfsa: p.tfsa,
          rrsp: p.rrsp,
          lira: p.lira,
          nonreg: p.nonreg,
          total: p.tfsa + p.rrsp + p.lira + p.nonreg,
        },
      });
    });

    const sum = (f: (x: PersonYear) => number) => perPerson.reduce((s, x) => s + f(x), 0);
    const total = perPerson.reduce((s, x) => s + x.balances.total, 0);
    if (shortfall > 1 && depletionAge == null) depletionAge = age;
    totalTaxes += res.taxes;
    totalClawback += res.claw;

    rows.push({
      age,
      year: thisYear + yearsFromNow,
      rrifDraw: sum((x) => x.rrifDraw),
      lifDraw: sum((x) => x.lifDraw),
      nonregDraw: sum((x) => x.nonregDraw),
      tfsaDraw: sum((x) => x.tfsaDraw),
      cpp: sum((x) => x.cpp),
      oas: sum((x) => x.oas),
      oasClawback: res.claw,
      otherIncome: sum((x) => x.otherIncome),
      taxes: res.taxes,
      spending: need,
      shortfall,
      pensionSplit: res.split,
      people: perPerson,
      balances: {
        tfsa: sum((x) => x.balances.tfsa),
        rrsp: sum((x) => x.balances.rrsp),
        lira: sum((x) => x.balances.lira),
        nonreg: sum((x) => x.balances.nonreg),
        total,
      },
    });
  }

  const last = rows[rows.length - 1];
  return {
    rows,
    depletionAge,
    success: depletionAge == null,
    endingBalance: last ? last.balances.total : 0,
    totalTaxes,
    totalClawback,
  };
}

function adjustedCpp(spec: PersonSpec): number {
  const base = spec.cppAt65;
  if (spec.cppStartAge < 65) return base * (1 - 0.006 * (65 - spec.cppStartAge) * 12);
  if (spec.cppStartAge > 65)
    return base * (1 + 0.0084 * Math.min(60, (spec.cppStartAge - 65) * 12));
  return base;
}

export { adjustedCpp as cppAdjustedForStartAge };

/** Engine 1 — earliest age at which the plan survives to life expectancy. */
export function earliestRetirementAge(input: PlannerInputs): number | null {
  for (let age = Math.max(input.self.age, 50); age <= 80; age += 1) {
    const p = projectRetirement({ ...input, retirementAge: age });
    if (p.success) return age;
  }
  return null;
}
