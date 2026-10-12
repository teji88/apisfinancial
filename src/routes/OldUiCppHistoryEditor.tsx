import { useState, useMemo, Fragment } from "react";
import { calculateCppBenefit } from "@/lib/retirement/benefits/CppCalculator";
import { getYmpe } from "@/lib/retirement/benefits/ympeTable";

interface OldUiCppHistoryEditorProps {
  birthYear: number;
  retirementAge: number;
  earningsHistory: Array<{ year: number; earnings: number }>;
  /** Legacy single-number fallback for future years without an explicit row. Read-only now. */
  futureEarnings: number;
  childRearingYears: number[];
  onHistoryChange: (history: Array<{ year: number; earnings: number }>) => void;
  onChildRearingChange: (years: number[]) => void;
  /** Called right before the editor expands (e.g. to expand simplified inputs into the table). */
  onBeforeExpand?: () => void;
  /** Called when the user reverts to the simplified estimate (should clear detailed state). */
  onRevertToSimplified?: () => void;
}

function formatCad(n: number): string {
  return n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
}

export function OldUiCppHistoryEditor({
  birthYear,
  retirementAge,
  earningsHistory,
  futureEarnings,
  childRearingYears,
  onHistoryChange,
  onChildRearingChange,
  onBeforeExpand,
  onRevertToSimplified,
}: OldUiCppHistoryEditorProps) {
  const [expanded, setExpanded] = useState(false);
  const [fillValue, setFillValue] = useState("");

  const currentYear = new Date().getFullYear();
  const startYear = Math.max(birthYear + 18, 1966);
  // Future rows run to the earlier of retirement age and 65 (post-65 working
  // years earn PRBs, a separate calculation — not base CPP).
  const endYear = Math.min(birthYear + Math.max(0, retirementAge), birthYear + 65);
  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = startYear; y <= endYear; y++) list.push(y);
    return list;
  }, [startYear, endYear]);
  const futureYears = useMemo(() => years.filter((y) => y > currentYear), [years, currentYear]);

  const historyMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const { year, earnings } of earningsHistory) {
      map.set(year, earnings);
    }
    return map;
  }, [earningsHistory]);

  const calculation = useMemo(() => {
    if (!expanded) return null;
    const history = years.map((year) => ({
      year,
      earnings: historyMap.get(year) ?? 0,
    }));
    try {
      return calculateCppBenefit({
        birthYear,
        birthMonth: 6,
        earningsHistory: history,
        futureAnnualEarnings: futureEarnings,
        retirementAge,
        childRearingYears,
        cppStartAge: 65,
      });
    } catch {
      return null;
    }
  }, [expanded, years, historyMap, birthYear, futureEarnings, retirementAge, childRearingYears]);

  const updateYear = (year: number, value: number | undefined) => {
    const next = new Map(historyMap);
    if (value === undefined || value <= 0) {
      next.delete(year);
    } else {
      next.set(year, value);
    }
    onHistoryChange(Array.from(next.entries()).map(([y, earnings]) => ({ year: y, earnings })));
  };

  /** Bulk-fill every future year with one value (writes rows, not a separate field). */
  const applyFillAll = () => {
    const v = Number(fillValue);
    const next = new Map(historyMap);
    for (const y of futureYears) {
      if (fillValue.trim() === "" || !(v > 0)) {
        next.delete(y);
      } else {
        next.set(y, v);
      }
    }
    onHistoryChange(Array.from(next.entries()).map(([y, earnings]) => ({ year: y, earnings })));
    setFillValue("");
  };

  const toggleChildRearing = (year: number) => {
    const current = new Set(childRearingYears);
    if (current.has(year)) {
      current.delete(year);
    } else {
      current.add(year);
    }
    onChildRearingChange(Array.from(current).sort((a, b) => a - b));
  };

  const handleExpand = () => {
    onBeforeExpand?.();
    setExpanded(true);
  };

  const handleRevert = () => {
    onRevertToSimplified?.();
    setExpanded(false);
  };

  if (!expanded) {
    return (
      <div className="mt-2">
        <button
          type="button"
          onClick={handleExpand}
          className="text-sm text-primary hover:underline"
        >
          Use detailed year-by-year earnings history (more accurate)
        </button>
        <p className="mt-1 text-xs text-muted-foreground">
          Enter each year's earnings from your CRA My Account for a precise CPP calculation with automatic dropout rules.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Detailed CPP earnings history</p>
        <button
          type="button"
          onClick={handleRevert}
          className="text-xs text-muted-foreground hover:underline"
        >
          Use simplified estimate instead
        </button>
      </div>

      {calculation && (
        <div className="rounded bg-muted p-2 text-sm">
          <span className="font-medium">Calculated CPP base: {formatCad(calculation.cppBaseMonthly)}/mo</span>
          <span className="ml-2 text-xs text-muted-foreground">
            ({calculation.contributoryYears} years, {calculation.dropoutYears} dropped)
          </span>
        </div>
      )}

      {futureYears.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 rounded bg-muted/50 p-2">
          <div className="flex-1 min-w-40">
            <label className="text-xs text-muted-foreground">
              Fill all future years ({futureYears[0]}–{futureYears[futureYears.length - 1]}) with
            </label>
            <input
              type="number"
              min={0}
              value={fillValue}
              placeholder="e.g. 75000"
              onChange={(e) => setFillValue(e.target.value)}
              className="mt-1 w-full rounded border px-2 py-1 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={applyFillAll}
            className="rounded border px-2 py-1 text-xs hover:bg-muted"
          >
            Apply to all future years
          </button>
          <p className="w-full text-[11px] text-muted-foreground">
            Leave blank and apply to clear future years. Or edit each year individually below.
          </p>
        </div>
      )}

      <div className="max-h-64 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background">
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1">Year</th>
              <th className="py-1">YMPE</th>
              <th className="py-1">Your earnings</th>
              <th className="py-1">Child-rearing?</th>
            </tr>
          </thead>
          <tbody>
            {years.map((year) => (
              <Fragment key={year}>
                {year === currentYear + 1 && futureYears.length > 0 && (
                  <tr>
                    <td colSpan={4} className="bg-muted/60 px-1 py-1 text-[11px] font-medium text-muted-foreground">
                      Future years — enter expected earnings (today's $)
                    </td>
                  </tr>
                )}
                <tr className="border-t">
                  <td className="py-1">{year}</td>
                  <td className="py-1 text-muted-foreground">{formatCad(getYmpe(year))}</td>
                  <td className="py-1">
                    <input
                      type="number"
                      min={0}
                      value={historyMap.get(year) ?? ""}
                      placeholder="0"
                      onChange={(e) => {
                        const v = e.target.value === "" ? undefined : Math.max(0, Number(e.target.value));
                        updateYear(year, v);
                      }}
                      className="w-28 rounded border px-1 py-0.5 text-sm"
                    />
                  </td>
                  <td className="py-1">
                    {year <= currentYear ? (
                      <input
                        type="checkbox"
                        checked={childRearingYears.includes(year)}
                        onChange={() => toggleChildRearing(year)}
                        className="h-4 w-4"
                        title="Primary caregiver for child under 7"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Find your history in CRA My Account → CPP Statement of Contributions. The 17% general dropout is automatic.
      </p>
    </div>
  );
}
