/**
 * MapleWealth retirement engine.
 * Engine 1: forward projection → earliest sustainable retirement age.
 * Engine 2: tax-efficient drawdown → year-by-year withdrawal matrix.
 * All amounts are nominal CAD unless stated otherwise.
 */

import {
  computeTax,
  nextFederalBracketTop,
  type ProvinceCode,
} from "./tax";

/* ---------------------------------- CPP / OAS --------------------------------- */

export const CPP_MAX_MONTHLY_65 = 1_507.65;
export const OAS_MAX_MONTHLY_65 = 734.95;
export const OAS_CLAWBACK_THRESHOLD = 95_323;
export const OAS_CLAWBACK_RATE = 0.15;

/** Annual CPP at 65 in today's dollars for a given share of the maximum. */
export function cppAt(startAge: number, pctOfMax: number): number {
  const base = CPP_MAX_MONTHLY_65 * 12 * (pctOfMax / 100);
  if (startAge < 65) {
    const months = (65 - startAge) * 12;
    return base * (1 - 0.006 * months);
  }
  if (startAge > 65) {
    const months = Math.min(60, (startAge - 65) * 12);
    return base * (1 + 0.0084 * months);
  }
  return base;
}

/** Annual OAS at the chosen start age, today's dollars, before clawback. */
export function oasAt(startAge: number): number {
  const base = OAS_MAX_MONTHLY_65 * 12;
  const months = Math.min(60, Math.max(0, (startAge - 65) * 12));
  return base * (1 + 0.006 * months);
}

export function oasClawback(netIncome: number, oasReceived: number): number {
  if (netIncome <= OAS_CLAWBACK_THRESHOLD) return 0;
  return Math.min(oasReceived, (netIncome - OAS_CLAWBACK_THRESHOLD) * OAS_CLAWBACK_RATE);
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

export type PlannerInputs = {
  currentAge: number;
  retirementAge: number;
  lifeExpectancy: number;
  province: ProvinceCode;
  inflation: number; // %
  growth: number; // %
  desiredIncome: number; // after-tax, today's CAD
  annualSavings: number; // contributions until retirement, today's CAD
  cppStartAge: number;
  cppPct: number;
  oasStartAge: number;
  married: boolean;
  spouseAge: number | null;
  spouseRrsp: number;
  spouseTfsa: number;
  spouseIncome: number; // expected taxable retirement income
  balances: {
    tfsa: number;
    rrsp: number; // RRSP + spousal RRSP + FHSA
    lira: number;
    nonreg: number;
  };
  /** Share of the non-registered balance that is unrealized gain. */
  nonregGainRatio: number;
};

export type YearRow = {
  age: number;
  year: number;
  rrifDraw: number;
  lifDraw: number;
  nonregDraw: number;
  tfsaDraw: number;
  cpp: number;
  oas: number; // net of clawback
  oasClawback: number;
  taxes: number;
  spending: number;
  shortfall: number;
  balances: { tfsa: number; rrsp: number; lira: number; nonreg: number; total: number };
};

export type Projection = {
  rows: YearRow[];
  depletionAge: number | null;
  success: boolean;
  endingBalance: number;
};

/* ------------------------------- Drawdown solver ------------------------------ */

function bisect(f: (x: number) => number, lo: number, hi: number): number {
  if (f(hi) < 0) return hi;
  if (f(lo) > 0) return lo;
  let a = lo;
  let b = hi;
  for (let i = 0; i < 60; i += 1) {
    const m = (a + b) / 2;
    if (f(m) < 0) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

export function projectRetirement(input: PlannerInputs): Projection {
  const infl = input.inflation / 100;
  const growth = input.growth / 100;
  const thisYear = new Date().getUTCFullYear();

  let tfsa = input.balances.tfsa;
  let rrsp = input.balances.rrsp;
  let lira = input.balances.lira;
  let nonreg = input.balances.nonreg;
  let nonregAcb = nonreg * (1 - input.nonregGainRatio);

  const retireAge = Math.max(input.retirementAge, input.currentAge);

  // Accumulation phase.
  for (let age = input.currentAge; age < retireAge; age += 1) {
    const years = age - input.currentAge;
    const contribution = input.annualSavings * (1 + infl) ** years;
    const total = tfsa + rrsp + lira + nonreg;
    const share = (b: number) => (total > 0 ? b / total : 0);
    const toTfsa = contribution * (total > 0 ? share(tfsa) : 0.4);
    const toRrsp = contribution * (total > 0 ? share(rrsp) : 0.4);
    const toNonreg = contribution - toTfsa - toRrsp;
    tfsa = (tfsa + toTfsa) * (1 + growth);
    rrsp = (rrsp + toRrsp) * (1 + growth);
    lira = lira * (1 + growth);
    nonregAcb += toNonreg;
    nonreg = (nonreg + toNonreg) * (1 + growth);
  }

  const rows: YearRow[] = [];
  let depletionAge: number | null = null;

  for (let age = retireAge; age <= input.lifeExpectancy; age += 1) {
    const yearsFromNow = age - input.currentAge;
    const indexation = (1 + infl) ** yearsFromNow;
    const need = input.desiredIncome * indexation;

    const cpp = age >= input.cppStartAge ? cppAt(input.cppStartAge, input.cppPct) * indexation : 0;
    const oasGross = age >= Math.max(65, input.oasStartAge) ? oasAt(input.oasStartAge) * indexation : 0;

    // Mandatory minimums once converted (RRSP→RRIF, LIRA→LIF at 71 at the latest).
    const converted = age >= 71;
    const rrifMin = converted ? rrsp * rrifMinFactor(age) : 0;
    const lifMin = converted ? lira * rrifMinFactor(age) : 0;
    const lifCap = converted ? lira * lifMaxFactor(age) : lira * lifMaxFactor(age);

    const spouseAge = input.spouseAge == null ? age : input.spouseAge + (age - retireAge);
    const spouseBase = input.married
      ? computeTax({
          ordinary: input.spouseIncome * indexation,
          province: input.province,
          age: spouseAge,
          pensionIncome: input.spouseIncome > 0 ? input.spouseIncome * indexation : 0,
        }).total
      : 0;

    /** Household tax and net cash for a given set of withdrawals. */
    const evaluate = (regDraw: number, lifDraw: number, nonregDraw: number, tfsaDraw: number) => {
      const pension = regDraw + lifDraw;
      const splittable = input.married && age >= 65 ? pension * 0.5 : 0;
      const ordinarySelf = cpp + oasGross + pension - splittable;
      const gainRatio = nonreg > 0 ? Math.max(0, 1 - nonregAcb / nonreg) : 0;
      const gains = nonregDraw * gainRatio;

      const selfTax = computeTax({
        ordinary: ordinarySelf,
        capitalGains: gains,
        province: input.province,
        age,
        pensionIncome: age >= 65 ? pension - splittable : 0,
      });
      const claw = oasClawback(selfTax.netIncome, oasGross);
      let spouseTax = 0;
      if (input.married) {
        spouseTax =
          computeTax({
            ordinary: input.spouseIncome * indexation + splittable,
            province: input.province,
            age: spouseAge,
            pensionIncome: splittable,
          }).total - spouseBase;
      }
      const taxes = selfTax.total + Math.max(0, spouseTax) + claw;
      const cash = cpp + oasGross + pension + nonregDraw + tfsaDraw;
      return { net: cash - taxes, taxes, claw, gains };
    };

    // Step 1 — mandatory minimums only.
    let regDraw = rrifMin;
    let lifDraw = lifMin;
    let nonregDraw = 0;
    let tfsaDraw = 0;
    let res = evaluate(regDraw, lifDraw, nonregDraw, tfsaDraw);

    // Step 2 — top up from registered money while staying inside the low brackets
    // and below the OAS clawback threshold.
    if (res.net < need) {
      const baseOrdinary = cpp + oasGross + regDraw + lifDraw;
      const bracketTop = nextFederalBracketTop(baseOrdinary);
      const ceiling = Math.min(
        bracketTop,
        oasGross > 0 ? OAS_CLAWBACK_THRESHOLD * indexation ** 0 : Infinity,
      );
      const room = Math.max(0, ceiling - baseOrdinary);
      const extraLif = Math.min(room, Math.max(0, lifCap - lifDraw), lira - lifDraw);
      const extraReg = Math.min(Math.max(0, room - extraLif), Math.max(0, rrsp - regDraw));
      const maxExtra = extraLif + extraReg;
      if (maxExtra > 0) {
        const solved = bisect(
          (x) => {
            const l = Math.min(x, extraLif);
            const r = x - l;
            return evaluate(regDraw + r, lifDraw + l, nonregDraw, tfsaDraw).net - need;
          },
          0,
          maxExtra,
        );
        const l = Math.min(solved, extraLif);
        lifDraw += l;
        regDraw += solved - l;
        res = evaluate(regDraw, lifDraw, nonregDraw, tfsaDraw);
      }
    }

    // Step 3 — non-registered.
    if (res.net < need && nonreg > 0) {
      nonregDraw = bisect(
        (x) => evaluate(regDraw, lifDraw, x, tfsaDraw).net - need,
        0,
        nonreg,
      );
      res = evaluate(regDraw, lifDraw, nonregDraw, tfsaDraw);
    }

    // Step 4 — TFSA (tax-free, never in clawback income).
    if (res.net < need && tfsa > 0) {
      tfsaDraw = Math.min(tfsa, need - res.net);
      res = evaluate(regDraw, lifDraw, nonregDraw, tfsaDraw);
    }

    // Step 5 — extra registered beyond the bracket ceiling if still short.
    if (res.net < need) {
      const roomReg = Math.max(0, rrsp - regDraw);
      const roomLif = Math.max(0, Math.min(lira - lifDraw, lifCap - lifDraw));
      const maxExtra = roomReg + roomLif;
      if (maxExtra > 0) {
        const solved = bisect(
          (x) => {
            const l = Math.min(x, roomLif);
            const r = x - l;
            return evaluate(regDraw + r, lifDraw + l, nonregDraw, tfsaDraw).net - need;
          },
          0,
          maxExtra,
        );
        const l = Math.min(solved, roomLif);
        lifDraw += l;
        regDraw += solved - l;
        res = evaluate(regDraw, lifDraw, nonregDraw, tfsaDraw);
      }
    }

    const shortfall = Math.max(0, need - res.net);

    // Apply withdrawals.
    const gainRatio = nonreg > 0 ? Math.max(0, 1 - nonregAcb / nonreg) : 0;
    nonregAcb = Math.max(0, nonregAcb - nonregDraw * (1 - gainRatio));
    rrsp = Math.max(0, rrsp - regDraw);
    lira = Math.max(0, lira - lifDraw);
    nonreg = Math.max(0, nonreg - nonregDraw);
    tfsa = Math.max(0, tfsa - tfsaDraw);

    // Surplus after-tax cash is reinvested in the non-registered account.
    const surplus = Math.max(0, res.net - need);
    nonreg += surplus;
    nonregAcb += surplus;

    // Growth for the remainder of the year.
    rrsp *= 1 + growth;
    lira *= 1 + growth;
    tfsa *= 1 + growth;
    nonreg *= 1 + growth;

    const total = rrsp + lira + tfsa + nonreg;
    if (shortfall > 1 && depletionAge == null) depletionAge = age;

    rows.push({
      age,
      year: thisYear + (age - input.currentAge),
      rrifDraw: regDraw,
      lifDraw,
      nonregDraw,
      tfsaDraw,
      cpp,
      oas: Math.max(0, oasGross - res.claw),
      oasClawback: res.claw,
      taxes: res.taxes,
      spending: need,
      shortfall,
      balances: { tfsa, rrsp, lira, nonreg, total },
    });
  }

  const last = rows[rows.length - 1];
  return {
    rows,
    depletionAge,
    success: depletionAge == null,
    endingBalance: last ? last.balances.total : 0,
  };
}

/** Engine 1 — earliest age at which the plan survives to life expectancy. */
export function earliestRetirementAge(input: PlannerInputs): number | null {
  for (let age = Math.max(input.currentAge, 50); age <= 80; age += 1) {
    const p = projectRetirement({ ...input, retirementAge: age });
    if (p.success) return age;
  }
  return null;
}
