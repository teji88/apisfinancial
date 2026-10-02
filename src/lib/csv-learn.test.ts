import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildLearnedProfile,
  deleteLearnedProfile,
  fingerprintHeaders,
  loadLearnedProfiles,
  matchLearnedProfile,
  parseWithLearnedProfile,
  saveLearnedProfile,
  type LearnedProfile,
} from "./csv-learn";

const SAMPLE_HEADERS = ["Trade Date", "Action", "Ticker", "Qty", "Unit Price", "Net Amount"];

function sampleProfile(): LearnedProfile {
  return buildLearnedProfile({
    name: "Test Broker",
    headers: SAMPLE_HEADERS,
    columns: {
      date: "Trade Date",
      type: "Action",
      symbol: "Ticker",
      quantity: "Qty",
      price: "Unit Price",
      amount: "Net Amount",
    },
    typeMap: { bot: "BUY", sld: "SELL" },
  });
}

function sampleTable(): string[][] {
  return [
    SAMPLE_HEADERS,
    ["2026-01-05", "BOT", "AAPL", "10", "150.00", "1500.00"],
    ["2026-01-06", "SLD", "AAPL", "5", "160.00", "800.00"],
    ["2026-01-07", "DIV", "AAPL", "", "", "25.50"],
    ["", "", "", "", "", ""],
    ["not-a-date", "BOT", "AAPL", "1", "1", "1"],
  ];
}

describe("fingerprintHeaders", () => {
  it("normalizes case, underscores and whitespace, then sorts", () => {
    expect(fingerprintHeaders(["Trade_Date", "  ACTION ", "Ticker"])).toEqual([
      "action",
      "ticker",
      "trade date",
    ]);
  });

  it("drops empty headers", () => {
    expect(fingerprintHeaders(["A", "", "B"])).toEqual(["a", "b"]);
  });
});

describe("matchLearnedProfile", () => {
  it("matches on exact fingerprint regardless of column order", () => {
    const profile = sampleProfile();
    const shuffled = ["Ticker", "Net Amount", "Trade Date", "Qty", "Action", "Unit Price"];
    expect(matchLearnedProfile(shuffled, [profile])).toBe(profile);
  });

  it("does not match when a column is added or missing", () => {
    const profile = sampleProfile();
    expect(matchLearnedProfile([...SAMPLE_HEADERS, "Extra"], [profile])).toBeNull();
    expect(matchLearnedProfile(SAMPLE_HEADERS.slice(1), [profile])).toBeNull();
    expect(matchLearnedProfile(["Totally", "Different"], [profile])).toBeNull();
  });

  it("returns null for an empty registry", () => {
    expect(matchLearnedProfile(SAMPLE_HEADERS, [])).toBeNull();
  });
});

describe("parseWithLearnedProfile", () => {
  it("parses rows through the learned column mapping", () => {
    const result = parseWithLearnedProfile(sampleTable(), "test.csv", sampleProfile());
    expect(result.broker).toBe("Test Broker");
    expect(result.skipped).toBe(1); // the not-a-date row
    expect(result.transactions).toHaveLength(3);

    const [buy, sell, div] = result.transactions;
    expect(buy!.date).toBe("2026-01-05");
    expect(buy!.type).toBe("BUY"); // via typeMap: BOT -> BUY
    expect(buy!.symbol).toBe("AAPL");
    expect(buy!.quantity).toBe(10);
    expect(buy!.price).toBe(150);
    expect(buy!.confidence).toBe(0.9);

    expect(sell!.type).toBe("SELL");
    expect(sell!.quantity).toBe(5);

    // DIV is not in the typeMap; the standard normaliser maps it to DIVIDEND.
    expect(div!.type).toBe("DIVIDEND");
    expect(div!.amount).toBe(25.5);
  });

  it("leaves unrecognized actions as null instead of guessing", () => {
    const table = [
      SAMPLE_HEADERS,
      ["2026-01-05", "MYSTERY", "AAPL", "10", "150.00", "1500.00"],
    ];
    const result = parseWithLearnedProfile(table, "test.csv", sampleProfile());
    expect(result.transactions[0]!.type).toBeNull();
  });

  it("finds the header row below title lines", () => {
    const table = [
      ["Test Broker monthly statement"],
      ["Generated 2026-02-01"],
      SAMPLE_HEADERS,
      ["2026-01-05", "BOT", "AAPL", "10", "150.00", "1500.00"],
    ];
    const result = parseWithLearnedProfile(table, "test.csv", sampleProfile());
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]!.symbol).toBe("AAPL");
  });

  it("throws when the file no longer matches the saved layout", () => {
    const table = [["Something", "Else"], ["2026-01-05", "x"]];
    expect(() => parseWithLearnedProfile(table, "test.csv", sampleProfile())).toThrow(
      /does not match the saved/,
    );
  });

  it("throws when the profile has no date column", () => {
    const profile = buildLearnedProfile({
      name: "No date",
      headers: ["A"],
      columns: { amount: "A" },
    });
    expect(() => parseWithLearnedProfile([["A"], ["1"]], "t.csv", profile)).toThrow(
      /no date column/,
    );
  });

  it("uses the account column for the portfolio when mapped", () => {
    const profile = buildLearnedProfile({
      name: "Acct Broker",
      headers: ["Date", "Account", "Amount"],
      columns: { date: "Date", account: "Account", amount: "Amount" },
    });
    const result = parseWithLearnedProfile(
      [
        ["Date", "Account", "Amount"],
        ["2026-01-05", "My TFSA", "100"],
      ],
      "t.csv",
      profile,
    );
    expect(result.transactions[0]!.portfolio).toBe("My TFSA");
    expect(result.portfolios[0]!.name).toBe("My TFSA");
  });
});

describe("learned profile persistence", () => {
  const store: Record<string, string> = {};
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    });
  });

  it("round-trips save, load and delete", () => {
    expect(loadLearnedProfiles()).toEqual([]);
    const profile = sampleProfile();
    const afterSave = saveLearnedProfile(profile);
    expect(afterSave).toHaveLength(1);

    const loaded = loadLearnedProfiles();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe(profile.id);
    expect(loaded[0]!.columns.date).toBe("Trade Date");
    expect(loaded[0]!.typeMap).toEqual({ bot: "BUY", sld: "SELL" });

    // Saving the same id replaces instead of duplicating.
    saveLearnedProfile({ ...profile, name: "Renamed" });
    expect(loadLearnedProfiles()).toHaveLength(1);
    expect(loadLearnedProfiles()[0]!.name).toBe("Renamed");

    const afterDelete = deleteLearnedProfile(profile.id);
    expect(afterDelete).toEqual([]);
    expect(loadLearnedProfiles()).toEqual([]);
  });

  it("ignores corrupt stored data", () => {
    store["apis.learnedCsvProfiles"] = "not json{{";
    expect(loadLearnedProfiles()).toEqual([]);
    store["apis.learnedCsvProfiles"] = JSON.stringify([{ nope: true }]);
    expect(loadLearnedProfiles()).toEqual([]);
  });
});
