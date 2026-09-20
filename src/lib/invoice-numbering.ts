export interface InvoiceSequenceState {
  financialYear: string;
  lastNumber: number;
}

/**
 * India's GST financial year runs 1 April - 31 March, so a January invoice belongs to the
 * year that started the previous April. Returned as "2026-27" style.
 */
export function getFinancialYear(date: Date): string {
  const year = date.getFullYear();
  const startYear = date.getMonth() >= 3 ? year : year - 1;
  const endYearShort = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYearShort}`;
}

export function assignInvoiceNumber(
  date: Date,
  settings: { prefix: string; seriesMode: string; paddingDigits: number },
  sequence: InvoiceSequenceState
): string {
  const financialYear = getFinancialYear(date);

  if (settings.seriesMode === "reset-yearly" && sequence.financialYear !== financialYear) {
    sequence.lastNumber = 0;
  }
  sequence.financialYear = financialYear;
  sequence.lastNumber += 1;

  const runningNumber = String(sequence.lastNumber).padStart(settings.paddingDigits, "0");
  return `${settings.prefix}/${financialYear}/${runningNumber}`;
}