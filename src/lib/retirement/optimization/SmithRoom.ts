import type { DebtPaymentFrequency } from "@/lib/profile";

/**
 * Smith Manoeuvre "room" engine.
 *
 * For a readvanceable mortgage, every dollar of principal repaid becomes
 * HELOC room the user may (but need not) draw. Room available =
 * principal repaid since the start date − total drawn.
 */

export interface RoomInputs {
  /** Mortgage balance at the start date ($). */
  startBalance: number;
  /** Annual mortgage rate as a decimal. */
  rate: number;
  /** Regular payment amount ($). */
  payment: number;
  /** Payment frequency. */
  frequency: DebtPaymentFrequency;
  /** Date the manoeuvre started (YYYY-MM-DD) — room accrues from here. */
  startDate: string;
  /** Total drawn from the room so far ($). */
  totalDrawn: number;
  /** "Today" for the calculation (YYYY-MM-DD). */
  today: string;
}

export interface RoomResult {
  /** Total principal repaid since start → total room ever created ($). */
  roomCreated: number;
  /** Room created minus drawn ($). Never negative. */
  roomAvailable: number;
  /** Number of payments counted. */
  paymentsCounted: number;
}

/**
 * One mortgage term segment for segmented room calculation.
 * Terms come from the mortgage's termHistory (prior terms) plus current terms.
 */
export interface TermSegment {
  /** Segment start date (YYYY-MM-DD). */
  startDate: string;
  /** Segment end date (YYYY-MM-DD), exclusive. Null = runs to `today`. */
  endDate: string | null;
  /** Mortgage balance at segment start ($). */
  startBalance: number;
  /** Annual rate as a decimal. */
  rate: number;
  /** Regular payment amount ($). */
  payment: number;
  /** Payment frequency. */
  frequency: DebtPaymentFrequency;
}

const PERIODS_PER_YEAR: Record<DebtPaymentFrequency, number> = {
  weekly: 52,
  "accelerated-weekly": 52,
  biweekly: 26,
  "accelerated-biweekly": 26,
  "semi-monthly": 24,
  monthly: 12,
};

function parseDay(s: string): Date | null {
  const d = new Date(s + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}

export function computeRoom(inputs: RoomInputs): RoomResult {
  const start = parseDay(inputs.startDate);
  const today = parseDay(inputs.today);
  if (!start || !today || start > today) {
    return { roomCreated: 0, roomAvailable: 0, paymentsCounted: 0 };
  }

  const periodsPerYear = PERIODS_PER_YEAR[inputs.frequency] ?? 12;
  const periodicRate = Math.max(0, inputs.rate) / periodsPerYear;
  const payment = Math.max(0, inputs.payment);
  if (payment <= 0) {
    return { roomCreated: 0, roomAvailable: 0, paymentsCounted: 0 };
  }

  // Whole periods elapsed between start and today.
  const daysPerPeriod = 365.25 / periodsPerYear;
  const daysElapsed = (today.getTime() - start.getTime()) / 86_400_000;
  const periods = Math.min(600, Math.floor(daysElapsed / daysPerPeriod));

  let balance = Math.max(0, inputs.startBalance);
  let roomCreated = 0;
  let counted = 0;
  for (let i = 0; i < periods && balance > 0; i++) {
    const interest = balance * periodicRate;
    const principal = Math.min(balance, Math.max(0, payment - interest));
    balance -= principal;
    roomCreated += principal;
    counted++;
  }

  const roomAvailable = Math.max(0, roomCreated - Math.max(0, inputs.totalDrawn));
  return { roomCreated, roomAvailable, paymentsCounted: counted };
}

/**
 * Segmented room calculation across mortgage terms.
 *
 * Each term's principal repayments are computed with that term's own
 * rate/payment/frequency, so refinancing never rewrites history — old terms
 * apply before the refinance date, new terms after.
 */
export function computeRoomSegmented(
  segments: TermSegment[],
  totalDrawn: number,
  today: string,
): RoomResult {
  const todayD = parseDay(today);
  if (!todayD || segments.length === 0) {
    return { roomCreated: 0, roomAvailable: 0, paymentsCounted: 0 };
  }

  // Sort segments by start date; each runs until the next segment starts (or today).
  const sorted = [...segments]
    .map((s) => ({ ...s, start: parseDay(s.startDate), end: s.endDate ? parseDay(s.endDate) : null }))
    .filter((s) => s.start !== null)
    .sort((a, b) => a.start!.getTime() - b.start!.getTime());

  let roomCreated = 0;
  let counted = 0;
  for (let i = 0; i < sorted.length; i++) {
    const seg = sorted[i];
    const segEnd = seg.end ?? todayD;
    // Clamp: don't count before today, don't overlap the next segment.
    const nextStart = i + 1 < sorted.length ? sorted[i + 1].start! : todayD;
    const effectiveEnd = segEnd < nextStart ? segEnd : nextStart;
    if (seg.start! >= effectiveEnd || seg.start! > todayD) continue;
    const cappedEnd = effectiveEnd > todayD ? todayD : effectiveEnd;

    const periodsPerYear = PERIODS_PER_YEAR[seg.frequency] ?? 12;
    const periodicRate = Math.max(0, seg.rate) / periodsPerYear;
    const payment = Math.max(0, seg.payment);
    if (payment <= 0) continue;

    const daysPerPeriod = 365.25 / periodsPerYear;
    const daysElapsed = (cappedEnd.getTime() - seg.start!.getTime()) / 86_400_000;
    const periods = Math.min(600, Math.floor(daysElapsed / daysPerPeriod));

    let balance = Math.max(0, seg.startBalance);
    for (let p = 0; p < periods && balance > 0; p++) {
      const interest = balance * periodicRate;
      const principal = Math.min(balance, Math.max(0, payment - interest));
      balance -= principal;
      roomCreated += principal;
      counted++;
    }
  }

  const roomAvailable = Math.max(0, roomCreated - Math.max(0, totalDrawn));
  return { roomCreated, roomAvailable, paymentsCounted: counted };
}
