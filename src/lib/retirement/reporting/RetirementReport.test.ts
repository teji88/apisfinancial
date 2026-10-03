import { describe, expect, it } from "vitest";
import { createDefaultRetirementScenario } from "../scenario/defaults";
import { runBasicSimulation } from "../engines/SimulationCoordinator";
import { buildRetirementReport, buildPrintableRetirementReport, serializeRetirementReport } from "./RetirementReport";

describe("RetirementReport", () => {
  it("builds a report from the simulation without changing the scenario", () => {
    const scenario = createDefaultRetirementScenario(new Date("2026-01-01T00:00:00Z"));
    const simulation = runBasicSimulation(scenario, 500000, 2026, { TFSA: 500000 });
    const report = buildRetirementReport(simulation, scenario);

    expect(report.simulationId).toBe(simulation.simulationId);
    expect(report.engineVersion).toBe(simulation.engineVersion);
    expect(report.rulesVersion).toBe(simulation.rulesVersion);
    expect(report.summary.endingPortfolio).toBe(simulation.metrics.endingPortfolio);
    expect(report.scenario.id).toBe(scenario.id);
  });

  it("serializes as valid JSON and creates printable HTML", () => {
    const scenario = createDefaultRetirementScenario(new Date("2026-01-01T00:00:00Z"));
    const simulation = runBasicSimulation(scenario, 500000, 2026, { TFSA: 500000 });
    const report = buildRetirementReport(simulation, scenario);

    expect(() => JSON.parse(serializeRetirementReport(report))).not.toThrow();
    const html = buildPrintableRetirementReport(simulation, scenario);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Apis Financial Retirement Report");
    expect(html).toContain("Ending portfolio");
  });
});
