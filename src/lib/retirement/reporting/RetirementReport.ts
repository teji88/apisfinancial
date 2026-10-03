import type { RetirementScenario, SimulationResult } from "../domain/types";
import { buildRetirementAnalysis, type AnalysisViewModel } from "../analysis/RetirementAnalysis";

export interface RetirementReport {
  title: string;
  generatedAt: string;
  simulationId: string;
  scenarioHash?: string;
  engineVersion: string;
  rulesVersion: string;
  status: SimulationResult["status"];
  summary: {
    endingPortfolio: number;
    endingNetWorth: number;
    lifetimeSpending: number;
    lifetimeAfterTaxCash: number;
    lifetimeTax: number;
    totalBenefits: number;
    maximumSpendingShortfall: number;
    minimumPortfolio: number;
  };
  scenario: RetirementScenario;
  analysis: AnalysisViewModel | null;
  warnings: string[];
}

export function buildRetirementReport(
  result: SimulationResult,
  scenario: RetirementScenario,
): RetirementReport {
  const analysis = buildRetirementAnalysis(result);
  return {
    title: "Apis Financial Retirement Report",
    generatedAt: new Date().toISOString(),
    simulationId: result.simulationId,
    scenarioHash: result.scenarioHash,
    engineVersion: result.engineVersion,
    rulesVersion: result.rulesVersion,
    status: result.status,
    summary: {
      endingPortfolio: result.metrics.endingPortfolio,
      endingNetWorth: result.metrics.endingNetWorth,
      lifetimeSpending: result.metrics.lifetimeSpending,
      lifetimeAfterTaxCash: result.metrics.lifetimeAfterTaxCash,
      lifetimeTax: result.metrics.lifetimeTax,
      totalBenefits: result.metrics.totalBenefits,
      maximumSpendingShortfall: result.metrics.maximumSpendingShortfall,
      minimumPortfolio: result.metrics.minimumPortfolio,
    },
    scenario: structuredClone(scenario),
    analysis,
    warnings: result.warnings ?? [],
  };
}

export function serializeRetirementReport(report: RetirementReport): string {
  return JSON.stringify(report, null, 2);
}

function money(value: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function buildPrintableRetirementReport(
  result: SimulationResult,
  scenario: RetirementScenario,
): string {
  const report = buildRetirementReport(result, scenario);
  const rows = [
    ["Ending portfolio", money(report.summary.endingPortfolio)],
    ["Ending net worth", money(report.summary.endingNetWorth)],
    ["Lifetime spending", money(report.summary.lifetimeSpending)],
    ["Lifetime after-tax cash", money(report.summary.lifetimeAfterTaxCash)],
    ["Lifetime tax", money(report.summary.lifetimeTax)],
    ["Government benefits", money(report.summary.totalBenefits)],
    ["Maximum spending shortfall", money(report.summary.maximumSpendingShortfall)],
    ["Minimum portfolio", money(report.summary.minimumPortfolio)],
  ];
  const rowHtml = rows.map(([label, value]) => "<tr><th>" + label + "</th><td>" + value + "</td></tr>").join("");
  const warnings = report.warnings.length
    ? "<h2>Model notes</h2><ul>" + report.warnings.map((w) => "<li>" + escapeHtml(w) + "</li>").join("") + "</ul>"
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(report.title)}</title><style>
  body{font-family:system-ui,-apple-system,sans-serif;max-width:900px;margin:40px auto;padding:0 24px;color:#202124;line-height:1.5}
  h1{margin-bottom:4px}h2{margin-top:32px}table{border-collapse:collapse;width:100%;max-width:700px}th,td{text-align:left;border-bottom:1px solid #ddd;padding:10px 8px}th{font-weight:500}td{font-weight:650}.meta{color:#666;font-size:13px}.note{background:#f6f6f6;padding:14px;border-radius:8px}
  @media print{body{margin:20px auto}}
  </style></head><body><h1>${escapeHtml(report.title)}</h1>
  <p class="meta">Generated ${escapeHtml(report.generatedAt)} · Simulation ${escapeHtml(report.simulationId)} · Engine ${escapeHtml(report.engineVersion)} · Rules ${escapeHtml(report.rulesVersion)}</p>
  <h2>Retirement summary</h2><table>${rowHtml}</table>
  <h2>Scenario</h2><div class="note">Province: ${escapeHtml(report.scenario.household.province)} · Retirement age: ${report.scenario.goals.retirementAge} · Planning age: ${report.scenario.goals.planningAge} · Annual spending: ${money(report.scenario.goals.annualSpending)}</div>
  ${warnings}
  </body></html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
