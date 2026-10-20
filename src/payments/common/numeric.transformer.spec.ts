import { NumericTransformer } from './numeric.transformer';

describe('NumericTransformer', () => {
  const transformer = new NumericTransformer();

  it('converts numeric strings to numbers', () => {
    expect(transformer.from('123.45')).toBe(123.45);
    expect(transformer.from('0.0050')).toBe(0.005);
  });

  it('preserves null and undefined safely', () => {
    expect(transformer.from(null)).toBeNull();
    expect(transformer.from(undefined)).toBeUndefined();
  });

  it('does not expose NaN for invalid values', () => {
    expect(transformer.from('')).toBeNull();
    expect(transformer.from('not-a-number')).toBeNull();
  });
});
