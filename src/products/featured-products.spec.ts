import {
  MAX_FEATURED_PER_SELLER,
  cappedFeaturedCondition,
  effectiveFeaturedCondition,
} from './featured-products';

const squash = (sql: string) => sql.replace(/\s+/g, ' ').trim();

describe('destacado efectivo (predicado SQL)', () => {
  it('el tope por vendedor es 3', () => {
    expect(MAX_FEATURED_PER_SELLER).toBe(3);
  });

  describe('effectiveFeaturedCondition', () => {
    const sql = squash(effectiveFeaturedCondition('product'));

    it.each([
      ['la preferencia', 'product.featured_at IS NOT NULL'],
      ['producto activo', "product.status = 'active'"],
      ['visible', 'product.is_visible = true'],
      ['con stock', 'product.quantity > 0'],
      ['no borrado', 'product.deleted_at IS NULL'],
      ['vendedor aprobado', 'product_s.is_verified = true'],
      ['usuario activo', 'product_u.is_active = true'],
      ['Pro vigente', 'product_sub.ends_at > now()'],
    ])('exige %s', (_label, fragment) => {
      expect(sql).toContain(fragment);
    });

    it('un producto sin comunidad o de una comunidad pública y activa; nunca privada ni inactiva', () => {
      expect(sql).toContain('product.community_id IS NULL');
      expect(sql).toContain('product_c.is_active = true');
      expect(sql).toContain('product_c.is_private = false');
    });

    it('el Pro se comprueba con EXISTS sobre subscription del dueño de la tienda', () => {
      expect(sql).toContain('EXISTS ( SELECT 1 FROM subscription product_sub');
      expect(sql).toContain('product_sub.user_id = product_s.user_id');
      // No depende de ningún estado guardado de la suscripción, solo de ends_at.
      const subquery = sql.slice(sql.indexOf('FROM subscription'));
      expect(subquery).not.toContain('status');
    });

    it('no usa parámetros: se puede anidar en cualquier consulta', () => {
      expect(sql).not.toMatch(/[$:]\w+/);
    });

    it('los alias internos usan el prefijo recibido', () => {
      const other = squash(effectiveFeaturedCondition('p'));

      expect(other).toContain('p.featured_at IS NOT NULL');
      expect(other).toContain('p_s.is_verified = true');
      expect(other).not.toContain('product');
    });
  });

  describe('cappedFeaturedCondition', () => {
    it('recorta con ROW_NUMBER por vendedor, los más recientes primero', () => {
      const sql = squash(cappedFeaturedCondition('product'));

      expect(sql).toContain(
        'ROW_NUMBER() OVER ( PARTITION BY fp.seller_id ORDER BY fp.featured_at DESC, fp.id DESC )',
      );
      expect(sql).toContain(`ranked.rn <= ${MAX_FEATURED_PER_SELLER}`);
      expect(sql).toContain('product.id IN (');
    });

    it('la subconsulta aplica la misma condición de destacado efectivo', () => {
      const sql = squash(cappedFeaturedCondition('product'));

      expect(sql).toContain(squash(effectiveFeaturedCondition('fp')));
      expect(sql).toContain(squash(effectiveFeaturedCondition('product')));
    });

    it('el tope es configurable y siempre un entero no negativo', () => {
      expect(squash(cappedFeaturedCondition('product', 5))).toContain(
        'ranked.rn <= 5',
      );
      expect(squash(cappedFeaturedCondition('product', 2.9))).toContain(
        'ranked.rn <= 2',
      );
      expect(squash(cappedFeaturedCondition('product', -4))).toContain(
        'ranked.rn <= 0',
      );
    });
  });
});
