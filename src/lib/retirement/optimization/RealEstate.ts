/**
 * Investment-property P&L: cash flow, NOI, cap rate, cash-on-cash, equity.
 *
 * Per property:
 *   gross rent + other income, minus vacancy allowance = effective income
 *   effective income - operating expenses (tax, insurance, maintenance,
 *     management, condo fees, utilities, other) = NOI
 *   NOI - mortgage payment = cash flow
 *   cap rate = NOI / current value
 *   cash-on-cash = annual cash flow / cash invested
 *   equity = current value - mortgage balance  (feeds net-worth illiquid)
 *
 * Pre-tax. CCA/recapture are a separate tax module — not modeled here.
 */

export interface PropertyExpenses {
  propertyTax: number; // $/yr
  insurance: number; // $/yr
  maintenance: number; // $/yr
  managementPct: number; // % of effective income
  condoFees: number; // $/yr
  utilities: number; // $/yr landlord-paid
  other: number; // $/yr
}

export interface PropertyInputs {
  name: string;
  currentValue: number;
  mortgageBalance: number;
  mortgagePayment: number; // $/mo
  monthlyRent: number;
  otherIncome: number; // $/mo (parking, laundry…)
  vacancyPct: number; // % of gross
  expenses: PropertyExpenses;
  /** Cash invested: down payment + closing costs ($). */
  cashInvested: number;
  /** Big-ticket reserve: roof, furnace, appliances ($/yr, default 0). */
  capexReserveAnnual?: number;
}

export interface PropertyResult {
  name: string;
  annualRent: number;
  effectiveIncome: number;
  operatingExpenses: number;
  /** Operating expenses as % of effective income. */
  expenseRatioPct: number;
  noi: number;
  annualMortgage: number;
  capexReserveAnnual: number;
  cashFlowAnnual: number;
  cashFlowMonthly: number;
  capRatePct: number;
  cashOnCashPct: number;
  equity: number;
  expenseBreakdown: Array<{ label: string; annual: number }>;
}

export interface PortfolioRollup {
  properties: PropertyResult[];
  totalValue: number;
  totalMortgage: number;
  totalEquity: number;
  totalCashFlowMonthly: number;
  totalCashFlowAnnual: number;
}

export function analyzeProperty(p: PropertyInputs): PropertyResult {
  const clamp = (v: number) => Math.max(0, v);
  const annualRent = clamp(p.monthlyRent) * 12 + clamp(p.otherIncome) * 12;
  const vacancy = annualRent * (clamp(p.vacancyPct) / 100);
  const effectiveIncome = Math.max(0, annualRent - vacancy);

  const e = p.expenses;
  const management = effectiveIncome * (clamp(e.managementPct) / 100);
  const expenseBreakdown = [
    { label: "Property tax", annual: clamp(e.propertyTax) },
    { label: "Insurance", annual: clamp(e.insurance) },
    { label: "Maintenance", annual: clamp(e.maintenance) },
    { label: "Management", annual: management },
    { label: "Condo fees", annual: clamp(e.condoFees) },
    { label: "Utilities", annual: clamp(e.utilities) },
    { label: "Other", annual: clamp(e.other) },
  ];
  const operatingExpenses = expenseBreakdown.reduce((s, x) => s + x.annual, 0);
  const expenseRatioPct = effectiveIncome > 0 ? (operatingExpenses / effectiveIncome) * 100 : 0;
  const noi = effectiveIncome - operatingExpenses;
  const annualMortgage = clamp(p.mortgagePayment) * 12;
  const capexReserveAnnual = clamp(p.capexReserveAnnual ?? 0);
  const cashFlowAnnual = noi - annualMortgage - capexReserveAnnual;

  const value = clamp(p.currentValue);
  return {
    name: p.name,
    annualRent,
    effectiveIncome,
    operatingExpenses,
    expenseRatioPct,
    noi,
    annualMortgage,
    capexReserveAnnual,
    cashFlowAnnual,
    cashFlowMonthly: cashFlowAnnual / 12,
    capRatePct: value > 0 ? (noi / value) * 100 : 0,
    cashOnCashPct: clamp(p.cashInvested) > 0 ? (cashFlowAnnual / clamp(p.cashInvested)) * 100 : 0,
    equity: value - clamp(p.mortgageBalance),
    expenseBreakdown,
  };
}

/** Whole months since a YYYY-MM-DD date; null when the date is missing/invalid. */
export function monthsSince(dateStr: string | null, todayStr: string): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  const t = new Date(todayStr + "T00:00:00");
  if (isNaN(d.getTime()) || isNaN(t.getTime()) || d > t) return null;
  return (t.getFullYear() - d.getFullYear()) * 12 + (t.getMonth() - d.getMonth());
}

/** True when a property value estimate is older than 6 months (or never stamped). */
export function isValueStale(valueUpdated: string | null, todayStr: string): boolean {
  const m = monthsSince(valueUpdated, todayStr);
  return m === null || m > 6;
}

export function rollupProperties(inputs: PropertyInputs[]): PortfolioRollup {
  const properties = inputs.map(analyzeProperty);
  return {
    properties,
    totalValue: inputs.reduce((s, p) => s + Math.max(0, p.currentValue), 0),
    totalMortgage: inputs.reduce((s, p) => s + Math.max(0, p.mortgageBalance), 0),
    totalEquity: properties.reduce((s, r) => s + r.equity, 0),
    totalCashFlowMonthly: properties.reduce((s, r) => s + r.cashFlowMonthly, 0),
    totalCashFlowAnnual: properties.reduce((s, r) => s + r.cashFlowAnnual, 0),
  };
}
