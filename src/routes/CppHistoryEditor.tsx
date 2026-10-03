import { useState, useMemo } from "react";
import type { PersonScenario } from "@/lib/retirement/domain/types";
import { calculateCppBenefit } from "@/lib/retirement/benefits/CppCalculator";
import { getYmpe } from "@/lib/retirement/benefits/ympeTable";

interface CppHistoryEditorProps {
  member: PersonScenario;
  onChange: (updates: Partial<PersonScenario>) => void;
}

function formatCad(n: number): string {
  return n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });
}

export function CppHistoryEditor({ member, onChange }: CppHistoryEditorProps) {
  const [showHistory, setShowHistory] = useState(
    () => !!(member.cppEarningsHistory && member.cppEarningsHistory.length > 0)
  );

  const currentYear = new Date().getFullYear();
  const startYear = Math.max(member.birthYear + 18, 1966);
  const years = useMemo(() => {
    const list: number[] = [];
    for (let y = startYear; y <= currentYear; y++) list.push(y);
    return list;
  }, [startYear, currentYear]);

  const historyMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const { year, earnings } of member.cppEarningsHistory ?? []) {
      map.set(year, earnings);
    }
    return map;
  }, [member.cppEarningsHistory]);

  const calculation = useMemo(() => {
    if (!showHistory) return null;
    const history = years.map((year) => ({
      year,
      earnings: historyMap.get(year) ?? 0,
    }));
    try {
      return calculateCppBenefit({
        birthYear: member.birthYear,
        birthMonth: member.birthMonth,
        earningsHistory: history,
        futureAnnualEarnings: member.cppFutureEarnings ?? 0,
        childRearingYears: member.cppChildRearingYears ?? [],
        cppStartAge: typeof member.cppStartAge === "number" ? member.cppStartAge : 65,
      });
    } catch {
      return null;
    }
  }, [showHistory, years, historyMap, member]);

  const updateYear = (year: number, value: number | undefined) => {
    const next = new Map(historyMap);
    if (value === undefined || value <= 0) {
      next.delete(year);
    } else {
      next.set(year, value);
    }
    onChange({
      cppEarningsHistory: Array.from(next.entries()).map(([y, earnings]) => ({
        year: y,
        earnings,
      })),
    });
  };

  const toggleChildRearing = (year: number) => {
    const current = new Set(member.cppChildRearingYears ?? []);
    if (current.has(year)) {
      current.delete(year);
    } else {
      current.add(year);
    }
    onChange({ cppChildRearingYears: Array.from(current).sort((a, b) => a - b) });
  };

  if (!showHistory) {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setShowHistory(true)}
          className="text-sm text-primary hover:underline"
        >
          Calculate CPP from earnings history instead
        </button>
        <p className="mt-1 text-xs text-muted-foreground">
          Enter your year-by-year earnings (from your CRA My Account statement) for a precise CPP estimate.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">CPP earnings history</p>
        <button
          type="button"
          onClick={() => {
            setShowHistory(false);
            // Empty array = fall back to manual estimate (see resolveCppAt65)
            onChange({ cppEarningsHistory: [] });
          }}
          className="text-xs text-muted-foreground hover:underline"
        >
          Use manual estimate instead
        </button>
      </div>

      {calculation && (
        <div className="rounded bg-muted p-2 text-sm">
          <span className="font-medium">Calculated CPP at 65: {formatCad(calculation.cppAt65Monthly)}/mo</span>
          <span className="ml-2 text-xs text-muted-foreground">
            ({calculation.contributoryYears} contributory years, {calculation.dropoutYears} dropped)
          </span>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-sm">
          <span className="text-muted-foreground">Expected future annual earnings</span>
          <input
            type="number"
            min={0}
            value={member.cppFutureEarnings ?? ""}
            placeholder="e.g. 75000"
            onChange={(e) => {
              const raw = e.target.value;
              onChange({ cppFutureEarnings: raw === "" ? 0 : Math.max(0, Number(raw)) });
            }}
            className="mt-1 w-full rounded border px-2 py-1 text-sm"
          />
        </label>
      </div>

      <div className="max-h-64 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background">
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1">Year</th>
              <th className="py-1">YMPE</th>
              <th className="py-1">Your earnings</th>
              <th className="py-1" title="Child-rearing dropout: check if you were the primary caregiver for a child under 7 this year">
                Child-rearing?
              </th>
            </tr>
          </thead>
          <tbody>
            {years.map((year) => {
              const isChildRearing = (member.cppChildRearingYears ?? []).includes(year);
              return (
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
                      checked={isChildRearing}
                      onChange={() => toggleChildRearing(year)}
                      className="h-4 w-4"
                      title="Primary caregiver for child under 7"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Tip: Find your earnings history in CRA My Account → CPP Statement of Contributions.
        Leave years blank if you had no pensionable earnings. The 17% general dropout is applied automatically.
      </p>
    </div>
  );
}
