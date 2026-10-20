import { ValueTransformer } from 'typeorm';

type NumericValue = number | null | undefined;

/** Converts PostgreSQL numeric values (returned as strings) to numbers. */
export class NumericTransformer implements ValueTransformer {
  to(value: NumericValue): NumericValue {
    return value;
  }

  from(value: string | number | null | undefined): NumericValue {
    if (value === null || value === undefined) return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value.trim() === '') return null;

    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
}

export const numericTransformer = new NumericTransformer();
