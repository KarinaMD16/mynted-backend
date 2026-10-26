import { computeFeaturedPage, featuredQuota } from './featured-pagination';

describe('featuredQuota', () => {
  it.each([
    [1, 0],
    [2, 1],
    [3, 1],
    [4, 1],
    [7, 1],
    [8, 2],
    [10, 2],
    [12, 3],
    [20, 5],
    [50, 12],
    [100, 25],
  ])('limit %i -> cuota %i', (limit, expected) => {
    expect(featuredQuota(limit)).toBe(expected);
  });
});

describe('computeFeaturedPage', () => {
  const slots = (
    page: number,
    limit: number,
    featuredTotal: number,
    regularTotal: number,
  ) => computeFeaturedPage({ page, limit, featuredTotal, regularTotal });

  describe('con no destacados de sobra (las fórmulas de la cuota)', () => {
    // limit 12 -> Q = 3, F = 8: 3 + 3 + 2 destacados en las tres primeras páginas.
    it.each([
      // page, featuredOffset, featuredCount, regularOffset, regularCount
      [1, 0, 3, 0, 9],
      [2, 3, 3, 9, 9],
      [3, 6, 2, 18, 10],
      [4, 8, 0, 28, 12],
      [5, 8, 0, 40, 12],
    ])(
      'página %i',
      (page, featuredOffset, featuredCount, regularOffset, regularCount) => {
        expect(slots(page, 12, 8, 500)).toEqual({
          quota: 3,
          featuredOffset,
          featuredCount,
          regularOffset,
          regularCount,
        });
      },
    );

    it('coincide con destacados = min(Q, max(0, F-(p-1)Q)) y offset = (p-1)L - anteriores', () => {
      for (const [limit, featured] of [
        [10, 3],
        [20, 7],
        [8, 1],
        [4, 5],
      ]) {
        const quota = featuredQuota(limit);
        for (let page = 1; page <= 6; page += 1) {
          const before = Math.min(featured, (page - 1) * quota);
          const result = slots(page, limit, featured, 10_000);
          expect(result.featuredCount).toBe(
            Math.min(quota, Math.max(0, featured - (page - 1) * quota)),
          );
          expect(result.featuredOffset).toBe(before);
          expect(result.regularOffset).toBe((page - 1) * limit - before);
          expect(result.regularCount).toBe(limit - result.featuredCount);
        }
      }
    });
  });

  describe('cuando los no destacados no alcanzan a llenar la página', () => {
    it('3 destacados y 0 no destacados con limit 10 caben en una sola página (no se pierde ninguno)', () => {
      expect(slots(1, 10, 3, 0)).toMatchObject({
        featuredOffset: 0,
        featuredCount: 3,
        regularCount: 0,
      });
      expect(slots(2, 10, 3, 0).featuredCount).toBe(0);
    });

    it('3 destacados y 5 no destacados con limit 10: una página con los 8', () => {
      expect(slots(1, 10, 3, 5)).toMatchObject({
        featuredCount: 3,
        regularCount: 5,
      });
    });

    it('3 destacados y 7 no destacados con limit 8: 8 + 2', () => {
      expect(slots(1, 8, 3, 7)).toMatchObject({
        featuredCount: 2,
        regularCount: 6,
      });
      expect(slots(2, 8, 3, 7)).toMatchObject({
        featuredOffset: 2,
        featuredCount: 1,
        regularOffset: 6,
        regularCount: 1,
      });
    });

    it('limit 1 no tiene cuota: los no destacados van primero y los destacados al final', () => {
      expect(slots(1, 1, 2, 1)).toMatchObject({
        featuredCount: 0,
        regularCount: 1,
      });
      expect(slots(2, 1, 2, 1)).toMatchObject({
        featuredCount: 1,
        featuredOffset: 0,
        regularCount: 0,
      });
    });
  });

  describe('sin destacados (F = 0) es la paginación de siempre', () => {
    it.each([
      [1, 10, 0],
      [2, 10, 10],
      [3, 10, 20],
      [4, 7, 21],
    ])('página %i limit %i -> offset %i', (page, limit, offset) => {
      expect(slots(page, limit, 0, 50)).toEqual({
        quota: featuredQuota(limit),
        featuredOffset: 0,
        featuredCount: 0,
        regularOffset: offset,
        regularCount: limit,
      });
    });
  });

  describe('páginas fuera de rango', () => {
    it('más allá del último producto está vacía, aunque page sea enorme', () => {
      const result = slots(1_000_000_000, 10, 3, 25);

      expect(result.featuredCount).toBe(0);
      expect(result.regularCount).toBe(0);
    });

    it('la última página trae solo lo que queda', () => {
      // 3 + 25 = 28 productos, limit 10: 3 páginas (10, 10, 8).
      expect(
        slots(3, 10, 3, 25).featuredCount + slots(3, 10, 3, 25).regularCount,
      ).toBe(8);
      expect(slots(4, 10, 3, 25).featuredCount).toBe(0);
      expect(slots(4, 10, 3, 25).regularCount).toBe(0);
    });

    it('page o limit inválidos no producen rebanadas', () => {
      expect(slots(0, 10, 3, 25).regularCount).toBe(0);
      expect(slots(1, 0, 3, 25).regularCount).toBe(0);
    });
  });

  // Recorre todas las páginas de muchas combinaciones y comprueba que cada
  // producto sale exactamente una vez, en orden, con páginas llenas y
  // ceil((F+R)/limit) páginas.
  describe('propiedades sobre todas las combinaciones', () => {
    const cases: [number, number, number][] = [];
    for (const limit of [1, 2, 3, 4, 5, 8, 10, 12, 20]) {
      for (const featured of [0, 1, 2, 3, 5, 9]) {
        for (const regular of [0, 1, 2, 7, 8, 9, 10, 11, 25, 61]) {
          cases.push([limit, featured, regular]);
        }
      }
    }

    it.each(cases)(
      'limit %i, F=%i, R=%i: cada producto una vez, páginas llenas y total correcto',
      (limit, featuredTotal, regularTotal) => {
        const total = featuredTotal + regularTotal;
        const pages = Math.ceil(total / limit);
        const featuredSeen: number[] = [];
        const regularSeen: number[] = [];

        for (let page = 1; page <= pages; page += 1) {
          const slot = computeFeaturedPage({
            page,
            limit,
            featuredTotal,
            regularTotal,
          });
          for (let i = 0; i < slot.featuredCount; i += 1) {
            featuredSeen.push(slot.featuredOffset + i);
          }
          for (let i = 0; i < slot.regularCount; i += 1) {
            regularSeen.push(slot.regularOffset + i);
          }
          const size = slot.featuredCount + slot.regularCount;
          expect(size).toBe(page < pages ? limit : total - (pages - 1) * limit);
          // La cuota solo se rebasa cuando ya no quedan no destacados.
          if (slot.featuredCount > slot.quota) {
            expect(slot.regularOffset + slot.regularCount).toBe(regularTotal);
          }
        }

        expect(featuredSeen).toEqual(
          Array.from({ length: featuredTotal }, (_, i) => i),
        );
        expect(regularSeen).toEqual(
          Array.from({ length: regularTotal }, (_, i) => i),
        );
        // Una página más allá del total está vacía.
        const after = computeFeaturedPage({
          page: pages + 1,
          limit,
          featuredTotal,
          regularTotal,
        });
        expect(after.featuredCount + after.regularCount).toBe(0);
      },
    );
  });
});
