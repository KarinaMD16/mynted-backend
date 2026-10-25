import { FindOptionsWhere, IsNull, MoreThan, Raw } from 'typeorm';
import { Product, ProductStatus } from './entities/product.entity';
import { UnavailableReason } from './product-events';

type AvailabilityFields = Pick<
  Product,
  'status' | 'isVisible' | 'deletedAt' | 'quantity'
>;

// Disponible para comprar: activo, visible, no borrado y con stock.
export function isProductAvailable(product: AvailabilityFields): boolean {
  return (
    product.status === ProductStatus.ACTIVE &&
    product.isVisible &&
    !product.deletedAt &&
    product.quantity > 0
  );
}

// Motivo por el que no está disponible (null si lo está).
export function unavailableReason(
  product: AvailabilityFields,
): UnavailableReason | null {
  if (product.deletedAt) return 'deleted';
  if (product.status === ProductStatus.SOLD) return 'sold';
  if (product.status !== ProductStatus.ACTIVE) return 'inactive';
  if (product.quantity <= 0) return 'sold';
  if (!product.isVisible) return 'hidden';
  return null;
}

// Precio final = price con el descuento aplicado, redondeado a 2 decimales.
// price nunca se sobrescribe: el original queda en price.
export function computeFinalPrice(
  price: number,
  discountPercent: number | null | undefined,
): number {
  if (!discountPercent) return price;
  return Math.round(price * (1 - discountPercent / 100) * 100) / 100;
}

// Condición de producto visible al público: activo, visible, con stock y (por el
// @DeleteDateColumn) no borrado.
export const PUBLIC_PRODUCT_WHERE: FindOptionsWhere<Product> = {
  status: ProductStatus.ACTIVE,
  isVisible: true,
  // Un producto agotado no se lista aunque su status no se haya sincronizado.
  quantity: MoreThan(0),
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
