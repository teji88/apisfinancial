import { useState, useMemo } from "react";
import { calculateCppBenefit } from "@/lib/retirement/benefits/CppCalculator";
import { getYmpe } from "@/lib/retirement/benefits/ympeTable";

interface OldUiCppHistoryEditorProps {
  birthYear: number;
  earningsHistory: Array<{ year: number; earnings: number }>;
  futureEarnings: number;
  childRearingYears: number[];
  onHistoryChange: (history: Array<{ year: number; earnings: number }>) => void;
  onFutureEarningsChange: (value: number) => void;
  onChildRearingChange: (years: number[]) => void;
}

function formatCad(n: number): string {
  return n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
}

export function OldUiCppHistoryEditor({
  birthYear,
  earningsHistory,
  futureEarnings,
  childRearingYears,
  onHistoryChange,
  onFutureEarningsChange,
  onChildRearingChange,
}: OldUiCppHistoryEditorProps) {
  const [expanded, setExpanded] = useState(false);

  const currentYear = new Date().getFullYear();
  const startYear = Math.max(birthYear + 18, 1966);
  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = startYear; y <= currentYear; y++) list.push(y);
    return list;
  }, [startYear, currentYear]);

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
        childRearingYears,
        cppStartAge: 65,
      });
    } catch {
      return null;
    }
  }, [expanded, years, historyMap, birthYear, futureEarnings, childRearingYears]);

  const updateYear = (year: number, value: number | undefined) => {
    const next = new Map(historyMap);
    if (value === undefined || value <= 0) {
      next.delete(year);
    } else {
      next.set(year, value);
    }
    onHistoryChange(Array.from(next.entries()).map(([y, earnings]) => ({ year: y, earnings })));
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

  if (!expanded) {
    return (
      <div className="mt-2">
        <button
          type="button"
          onClick={() => setExpanded(true)}
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
          onClick={() => setExpanded(false)}
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

      <div>
        <label className="text-sm text-muted-foreground">Expected future annual earnings</label>
        <input
          type="number"
          min={0}
          value={futureEarnings || ""}
          placeholder="e.g. 75000"
          onChange={(e) => onFutureEarningsChange(Math.max(0, Number(e.target.value) || 0))}
          className="mt-1 w-full rounded border px-2 py-1 text-sm"
        />
      </div>

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
              <tr key={year} className="border-t">
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
                  <input
                    type="checkbox"
                    checked={childRearingYears.includes(year)}
                    onChange={() => toggleChildRearing(year)}
                    className="h-4 w-4"
                    title="Primary caregiver for child under 7"
                  />
                </td>
              </tr>
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
