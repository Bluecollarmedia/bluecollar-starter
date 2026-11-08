/**
 * Money helpers for quotes and invoices. All math is done in whole cents so
 * totals never drift by a penny from floating-point rounding.
 */

import type { LineItem } from '@/types/financial';

export function toCents(amount: number): number {
  return Math.round((Number(amount) || 0) * 100);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/** quantity × unit price, rounded to the cent. */
export function lineAmount(quantity: number, unitPrice: number): number {
  return fromCents(Math.round((Number(quantity) || 0) * toCents(unitPrice)));
}

export interface DocumentTotals {
  subtotal: number;
  taxAmount: number;
  total: number;
}

/** Subtotal of the lines, tax at `taxRate` percent, and the total. */
export function calcTotals(items: Pick<LineItem, 'amount'>[], taxRate: number): DocumentTotals {
  const subtotalCents = items.reduce((sum, i) => sum + toCents(i.amount), 0);
  const taxCents = Math.round((subtotalCents * (Number(taxRate) || 0)) / 100);
  return {
    subtotal: fromCents(subtotalCents),
    taxAmount: fromCents(taxCents),
    total: fromCents(subtotalCents + taxCents),
  };
}

/** Adds amounts in cents. */
export function sumMoney(values: number[]): number {
  return fromCents(values.reduce((s, v) => s + toCents(v), 0));
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** $1,234.50 */
export function formatMoney(amount: number): string {
  return usd.format(Number(amount) || 0);
}

/** Quantity without trailing zeros: 5000 → "5,000", 2.5 → "2.5". */
export function formatQuantity(q: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(Number(q) || 0);
}

/** "6.625%" */
export function formatPercent(rate: number): string {
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(Number(rate) || 0)}%`;
}

/** Parses what the user typed into a number ("$1,250.00" → 1250). Empty → NaN. */
export function parseAmount(text: string): number {
  const cleaned = text.replace(/[$,\s]/g, '');
  if (cleaned === '' || cleaned === '.') return NaN;
  return Number(cleaned);
}
