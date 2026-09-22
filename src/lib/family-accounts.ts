/**
 * RESP and RDSP drawdown rules.
 *
 * Both are taxed in the beneficiary's hands, not the subscriber's or the
 * plan-holder's, so neither ever adds to a parent's taxable income and neither
 * can trigger an OAS clawback. Only the grant-and-growth slice is taxable.
 * All figures are 2026 real dollars, matching the retirement engine.
 */

/** 2026 federal basic personal amount. */
export const BASIC_PERSONAL_AMOUNT = 16_129;
/** 2026 federal disability tax credit amount. */
export const DISABILITY_AMOUNT = 10_298;
/** Lowest combined federal + typical provincial rate on the first bracket. */
const LOW_COMBINED_RATE = 0.2;
/** Federal penalty tax on an Accumulated Income Payment, on top of marginal tax. */
export const AIP_PENALTY_RATE = 0.2;

export type EducationPlan = {
  /** Current RESP market value, CAD. */
  balance: number;
  /** Share of the balance that is the subscriber's own contributions (tax-free on the way out). */
  contributionRatio: number;
  /** Beneficiary's age today. */
  beneficiaryAge: number;
  /** Age post-secondary study starts. */
  studyStartAge: number;
  /** Number of study years the plan must cover. */
  studyYears: number;
  /** Other income the student expects each study year (summer job etc.). */
  studentOtherIncome: number;
};

export type DisabilityPlan = {
  /** Current RDSP market value, CAD. */
  balance: number;
  /** Share of the balance that is private contributions (tax-free on the way out). */
  contributionRatio: number;
  beneficiaryAge: number;
  /** Age payments begin — an LDAP must start by 60. */
  paymentStartAge: number;
  /** Years payments are spread across. */
  paymentYears: number;
  /** Other income the beneficiary expects each year. */
  beneficiaryOtherIncome: number;
};

export type FamilyWithdrawalYear = {
  age: number;
  /** Tax-free return of contributions (PSE for an RESP, private contributions for an RDSP). */
  taxFree: number;
  /** Grants and growth, taxable to the beneficiary (EAP for an RESP, the taxable DAP slice). */
  taxable: number;
  /** Credits sheltering the taxable slice this year. */
  shelter: number;
  tax: number;
  net: number;
};

export type FamilyPlanResult = {
  years: FamilyWithdrawalYear[];
  totalWithdrawn: number;
  totalTax: number;
  /** Average tax rate across the whole drawdown, percent. */
  effectiveRate: number;
  /** Plain-language notes shown beside the schedule. */
  notes: string[];
};

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function summarise(years: FamilyWithdrawalYear[], notes: string[]): FamilyPlanResult {
  const totalWithdrawn = years.reduce((s, y) => s + y.taxFree + y.taxable, 0);
  const totalTax = years.reduce((s, y) => s + y.tax, 0);
  return {
    years,
    totalWithdrawn,
    totalTax,
    effectiveRate: totalWithdrawn > 0 ? (totalTax / totalWithdrawn) * 100 : 0,
    notes,
  };
}

/**
 * RESP: contributions come out as a PSE payment, completely tax-free.
 * Grants and growth come out as an EAP taxed to the student, who almost always
 * has the basic personal amount and tuition credits free, so the bill is tiny.
 */
export function projectResp(plan: EducationPlan): FamilyPlanResult {
  const notes: string[] = [];
  if (plan.balance <= 0) return summarise([], notes);

  const years = Math.max(1, Math.round(plan.studyYears));
  const contribRatio = clamp01(plan.contributionRatio);
  const perYearTaxFree = (plan.balance * contribRatio) / years;
  const perYearTaxable = (plan.balance * (1 - contribRatio)) / years;
  const start = Math.max(plan.studyStartAge, plan.beneficiaryAge);

  const rows: FamilyWithdrawalYear[] = [];
  for (let i = 0; i < years; i += 1) {
    const shelter = BASIC_PERSONAL_AMOUNT;
    const income = perYearTaxable + plan.studentOtherIncome;
    const taxableAfterCredits = Math.max(0, income - shelter);
    // Attribute tax only to the plan's share of the student's income.
    const planShare = income > 0 ? perYearTaxable / income : 0;
    const tax = taxableAfterCredits * LOW_COMBINED_RATE * planShare;
    rows.push({
      age: start + i,
      taxFree: perYearTaxFree,
      taxable: perYearTaxable,
      shelter,
      tax,
      net: perYearTaxFree + perYearTaxable - tax,
    });
  }

  notes.push(
    "Contributions come back tax-free; grants and growth are taxed to the student, whose basic personal amount and tuition credits usually wipe the bill out.",
  );
  notes.push("RESP money never counts as your income, so it can never reduce your OAS.");
  if (perYearTaxable + plan.studentOtherIncome > BASIC_PERSONAL_AMOUNT) {
    notes.push(
      "Spreading the grant-and-growth portion over more study years keeps each year under the student's tax-free amount.",
    );
  }
  if (plan.beneficiaryAge >= 31) {
    notes.push(
      `If the plan is never used for school, the growth comes out as an accumulated income payment: your marginal rate plus a ${Math.round(AIP_PENALTY_RATE * 100)}% penalty, unless it is rolled into RRSP room.`,
    );
  }
  return summarise(rows, notes);
}

/**
 * RDSP: private contributions come out tax-free; grants, bonds and growth are
 * taxed to the beneficiary, who has both the basic personal amount and the
 * disability amount, so roughly the first $26,000 a year is tax-free.
 */
export function projectRdsp(plan: DisabilityPlan): FamilyPlanResult {
  const notes: string[] = [];
  if (plan.balance <= 0) return summarise([], notes);

  const years = Math.max(1, Math.round(plan.paymentYears));
  const contribRatio = clamp01(plan.contributionRatio);
  const perYearTaxFree = (plan.balance * contribRatio) / years;
  const perYearTaxable = (plan.balance * (1 - contribRatio)) / years;
  const start = Math.max(plan.paymentStartAge, plan.beneficiaryAge);
  const shelter = BASIC_PERSONAL_AMOUNT + DISABILITY_AMOUNT;

  const rows: FamilyWithdrawalYear[] = [];
  for (let i = 0; i < years; i += 1) {
    const income = perYearTaxable + plan.beneficiaryOtherIncome;
    const taxableAfterCredits = Math.max(0, income - shelter);
    const planShare = income > 0 ? perYearTaxable / income : 0;
    const tax = taxableAfterCredits * LOW_COMBINED_RATE * planShare;
    rows.push({
      age: start + i,
      taxFree: perYearTaxFree,
      taxable: perYearTaxable,
      shelter,
      tax,
      net: perYearTaxFree + perYearTaxable - tax,
    });
  }

  notes.push(
    `Payments are taxed to the beneficiary, who has the basic personal amount plus the disability amount — about ${Math.round(shelter / 1000)}k a year comes out tax-free.`,
  );
  notes.push("RDSP payments never count as your income, so they cannot reduce your OAS or GIS.");
  if (plan.paymentStartAge < plan.beneficiaryAge + 10) {
    notes.push(
      "Grants and bonds paid in the last 10 years must be repaid if money is withdrawn early (the assistance holdback rule).",
    );
  }
  if (plan.paymentStartAge > 60) {
    notes.push("Lifetime disability assistance payments must begin by age 60.");
  }
  return summarise(rows, notes);
}
