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
  frequency: "weekly" | "biweekly" | "monthly";
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

const PERIODS_PER_YEAR = { weekly: 52, biweekly: 26, monthly: 12 } as const;

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
