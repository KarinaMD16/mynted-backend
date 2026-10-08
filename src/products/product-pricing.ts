import { FindOptionsWhere, IsNull, Raw } from 'typeorm';
import { Product, ProductStatus } from './entities/product.entity';

// Precio final = price con el descuento aplicado, redondeado a 2 decimales.
// price nunca se sobrescribe: el original queda en price.
export function computeFinalPrice(
  price: number,
  discountPercent: number | null | undefined,
): number {
  if (!discountPercent) return price;
  return Math.round(price * (1 - discountPercent / 100) * 100) / 100;
}

// Condición de producto visible al público: activo, visible y (por el
// @DeleteDateColumn) no borrado.
export const PUBLIC_PRODUCT_WHERE: FindOptionsWhere<Product> = {
  status: ProductStatus.ACTIVE,
  isVisible: true,
};

// Filtro por rango de precio comparando contra el precio final (con
// descuento). Devuelve undefined si no hay rango.
export function finalPriceWhere(
  min: number | undefined,
  max: number | undefined,
): FindOptionsWhere<Product>['price'] | undefined {
  if (min === undefined && max === undefined) return undefined;

  return Raw(
    (alias) => {
      const discount = alias.replace(/"price"$/, '"discount_percent"');
      const finalPrice = `ROUND(${alias} * (1 - COALESCE(${discount}, 0) / 100), 2)`;
      const conditions: string[] = [];
      if (min !== undefined) conditions.push(`${finalPrice} >= :finalPriceMin`);
      if (max !== undefined) conditions.push(`${finalPrice} <= :finalPriceMax`);
      return conditions.join(' AND ');
    },
    { finalPriceMin: min, finalPriceMax: max },
  );
}

// Un producto sin comunidad es público; uno con comunidad solo si esta es
// pública y activa. Se combina con OR (un elemento por alternativa).
export const PUBLIC_COMMUNITY_ALTERNATIVES: FindOptionsWhere<Product>[] = [
  { communityId: IsNull() },
  { community: { isActive: true, isPrivate: false } },
];
