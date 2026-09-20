const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];

const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return [TENS[tens], ONES[ones]].filter(Boolean).join(" ");
}

function threeDigits(n: number): string {
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundred) parts.push(`${ONES[hundred]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(" ");
}

/** Converts a non-negative integer to words using the Indian numbering system (Crore/Lakh/Thousand). */
export function numberToIndianWords(value: number): string {
  const n = Math.floor(Math.abs(value));
  if (n === 0) return "Zero";

  const crore = Math.floor(n / 1e7);
  const lakh = Math.floor((n % 1e7) / 1e5);
  const thousand = Math.floor((n % 1e5) / 1e3);
  const hundred = n % 1e3;

  const segments = [
    crore ? `${threeDigits(crore)} Crore` : "",
    lakh ? `${threeDigits(lakh)} Lakh` : "",
    thousand ? `${threeDigits(thousand)} Thousand` : "",
    hundred ? threeDigits(hundred) : "",
  ].filter(Boolean);

  return segments.join(" ");
}

/** Renders a rupee amount per the challan convention: "RUPEES ... ONLY". Paise are rounded to the nearest rupee. */
export function amountInWords(amount: number): string {
  const rounded = Math.round(amount);
  return `Rupees ${numberToIndianWords(rounded)} Only`.toUpperCase();
}