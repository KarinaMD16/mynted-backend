import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { UsdRates, currencyFractionDigits } from '../pricing/currency';
import { ProductSort } from './dto/product-price-query.dto';

// Precio final (con descuento, igual que computeFinalPrice) dividido por la
// tasa de su moneda: queda expresado en la moneda pivote de `rates` (USD).
// Es NULL si la moneda del producto no tiene tasa.
export function pivotFinalPriceSql(
  alias: string,
  rates: UsdRates,
  prefix: string,
): { sql: string; parameters: ObjectLiteral } {
  const parameters: ObjectLiteral = {};
  const branches = [...rates.entries()].map(([currency, rate], index) => {
    parameters[`${prefix}Currency${index}`] = currency;
    parameters[`${prefix}Rate${index}`] = rate;
    return `WHEN :${prefix}Currency${index} THEN CAST(:${prefix}Rate${index} AS numeric)`;
  });
  const finalPrice = `ROUND(${alias}.price * (1 - COALESCE(${alias}.discountPercent, 0) / 100), 2)`;
  const rate =
    branches.length > 0
      ? `CASE ${alias}.currency ${branches.join(' ')} END`
      : 'NULL::numeric';
  return { sql: `(${finalPrice} / ${rate})`, parameters };
}

// priceMin/priceMax llegan en la moneda de visualización. Se comparan contra
// el precio convertido vía USD y redondeado igual que displayFinalPrice, así
// un producto que se ve en 100,00 entra con priceMax=100. Si la moneda de
// visualización no tiene tasa, solo son comparables sus propios productos.
export function applyDisplayPriceRange<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  rates: UsdRates,
  displayCurrency: string,
  priceMin: number | undefined,
  priceMax: number | undefined,
): void {
  if (priceMin === undefined && priceMax === undefined) return;

  const pivotRates: UsdRates = rates.has(displayCurrency)
    ? rates
    : new Map([[displayCurrency, 1]]);
  const { sql, parameters } = pivotFinalPriceSql(alias, pivotRates, 'range');
  const digits = currencyFractionDigits(displayCurrency);
  const displayed = `ROUND(${sql} * CAST(:rangeDisplayRate AS numeric), ${digits})`;

  qb.setParameters({
    ...parameters,
    rangeDisplayRate: pivotRates.get(displayCurrency),
  });
  if (priceMin !== undefined) {
    qb.andWhere(`${displayed} >= CAST(:rangeMin AS numeric)`, {
      rangeMin: priceMin,
    });
  }
  if (priceMax !== undefined) {
    qb.andWhere(`${displayed} <= CAST(:rangeMax AS numeric)`, {
      rangeMax: priceMax,
    });
  }
}

// newest: createdAt desc. price_asc/price_desc: precio final en USD; los
// productos sin tasa van al final. Empate por id descendente.
export function applyProductSort<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  alias: string,
  sort: ProductSort,
  rates: UsdRates | undefined,
): void {
  if (sort === ProductSort.NEWEST || !rates) {
    qb.orderBy(`${alias}.createdAt`, 'DESC');
  } else {
    const { sql, parameters } = pivotFinalPriceSql(alias, rates, 'sort');
    qb.setParameters(parameters).orderBy(
      sql,
      sort === ProductSort.PRICE_ASC ? 'ASC' : 'DESC',
      'NULLS LAST',
    );
  }
  qb.addOrderBy(`${alias}.id`, 'DESC');
}
