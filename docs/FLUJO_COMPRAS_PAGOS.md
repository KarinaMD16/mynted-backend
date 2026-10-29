# Flujo final de compras y pagos

Este documento describe el comportamiento actualmente implementado en el
backend de Mynted para compras, pagos, envíos, cancelaciones y reclamos.

## 1. Visión general

Una compra se inicia con `POST /payments/checkout`. El backend valida al
comprador, el producto, el destino de envío, el stock y la idempotencia antes
de cobrar. Si el gateway aprueba el pago, se crea una transacción completada,
se descuenta el stock y se actualiza la métrica del vendedor.

El estado del pago y el estado del envío son independientes:

```text
checkout -> paid -> shipped -> delivered
```

Las cancelaciones y los refunds cambian el estado del pago a `refunded`, pero
conservan la información histórica del envío.

## 2. Roles

- **Buyer:** compra productos, consulta sus compras, marca pedidos como
  entregados y abre disputes.
- **Seller:** publica productos, consulta sus ventas, marca pedidos como
  enviados y puede cancelar sus propias compras antes del envío.
- **SUPERADMIN:** consulta y resuelve disputes desde el panel administrativo.

Las operaciones de buyer y seller se validan contra la relación real de la
transacción; no basta con confiar en el producto actual.

## 3. Checkout

### Endpoint

```http
POST /payments/checkout
```

Requiere JWT y el header obligatorio:

```http
Idempotency-Key: clave-entre-8-y-128-caracteres
```

Body principal:

```json
{
  "productId": 42,
  "quantity": 1,
  "card": { "...": "..." },
  "shippingAddress": { "...": "..." }
}
```

Requisitos relevantes:

- el producto debe existir, estar activo, visible, no oculto ni desactivado;
- debe ser de tipo `sale`;
- debe tener precio y moneda válidos;
- el comprador no puede comprar su propio producto;
- la cantidad debe estar disponible;
- el país debe estar permitido por `Product.shipsTo`;
- la misma clave de idempotencia no puede representar otra operación.

El checkout crea primero una transacción `pending`. Si el gateway aprueba:

- `status` pasa a `completed`;
- `shippingStatus` pasa a `paid`;
- se descuenta el stock dentro de la misma transacción;
- `Seller.completedSalesCount` aumenta en uno;
- se guardan los snapshots de precio, comisión y gateway;
- después del commit se emiten los eventos de compra.

Si el gateway rechaza el pago, la transacción queda `failed`, no se descuenta
stock y no se emiten notificaciones de compra exitosa.

La clave de idempotencia reutiliza el resultado de una operación compatible.
Una operación con la misma clave pero distinto comprador, producto, cantidad o
dirección responde `409 Conflict`.

### Conversación previa a cotizar y comprar

Antes de cotizar o comprar, el vendedor debe haber enviado al menos un
mensaje en la conversación del comprador para ese producto. Si no existe esa
respuesta, `GET /payments/quote/:productId` y `POST /payments/checkout`
responden `403` con: `Primero conversa con el vendedor antes de comprar este producto`.

## 4. ShippingAddress

`shippingAddress` se recibe durante checkout y se guarda como snapshot JSONB
en `PaymentTransaction`. Los campos son:

- `fullName` — obligatorio;
- `phone` — obligatorio;
- `country` — obligatorio, ISO 3166-1 alpha-2;
- `province` — obligatorio;
- `city` — obligatorio;
- `line1` — obligatorio;
- `line2` — opcional;
- `postalCode` — opcional;
- `notes` — opcional.

El país se normaliza con `trim()` y mayúsculas. La dirección queda asociada a
la transacción histórica y no se reemplaza por cambios posteriores del perfil.

La dirección completa solo aparece en `GET /payments/:id` para el comprador o
vendedor autorizado. No se incluye en listados, notificaciones, productos,
comunidades ni respuestas públicas.

## 5. Product.shipsTo

`Product.shipsTo` es un `string[]` y se almacena en PostgreSQL como
`varchar(2)[]` en la columna `ships_to`.

Contiene códigos ISO 3166-1 alpha-2, por ejemplo:

```json
["CR", "US"]
```

El checkout normaliza el país solicitado con `trim + uppercase` y compara
contra los destinos configurados. Por tanto, `CR`, `cr` y ` Cr ` representan
el mismo país.

- `shipsTo: []` no permite ningún destino.
- Un valor `null` inesperado también se trata como ningún destino.
- No existe un sentinel global como `-1`.

Si el país no está permitido, el checkout responde `409 Conflict` con un
mensaje equivalente a:

```text
El producto no está disponible para envío al país indicado
```

La validación ocurre antes de cobrar, crear la compra exitosa, descontar stock,
actualizar métricas o emitir notificaciones.

## 6. Estados de pago

Los valores de `TransactionStatus` son:

```text
pending
completed
failed
refunded
```

`completed` significa que el cobro fue aprobado; no significa que el producto
ya fue enviado o entregado.

## 7. Estados de envío

Los valores de `ShippingStatus` son:

```text
paid
shipped
delivered
```

El estado es nullable para transacciones históricas y operaciones que no
llegaron a completarse.

## 8. Flujo normal

```diff
checkout
-> paid
-> shipped
-> delivered
```

En términos de pago, la transacción permanece `completed` durante `paid`,
`shipped` y `delivered`.

## 9. Marcar como enviado

```http
PATCH /payments/:id/ship
```

Solo puede ejecutarlo el seller dueño de la transacción. Requiere:

- `payment.status = completed`;
- `shippingStatus = paid`;
- `shippingAddress` existente.

El body acepta opcionalmente:

```json
{
  "trackingNumber": "ABC123",
  "carrier": "Correos de Costa Rica"
}
```

`trackingNumber` admite hasta 120 caracteres y `carrier` hasta 100. Ambos se
normalizan y pueden quedar en `null`. La operación establece `shippedAt` y
`shippingStatus = shipped` sin modificar el pago, el stock ni la dirección.

Un segundo intento o un estado incompatible responde `409 Conflict`.

## 10. Marcar como entregado

```http
PATCH /payments/:id/deliver
```

Solo puede ejecutarlo el buyer de esa transacción. Requiere:

- `payment.status = completed`;
- `shippingStatus = shipped`.

La operación establece `shippingStatus = delivered` y `deliveredAt`. No cambia
tracking, carrier, stock ni el estado del pago. Un intento duplicado responde
`409 Conflict`.

## 11. Cancelación del pedido

```http
POST /payments/:id/cancel
```

Solo el seller propietario puede cancelar. La transacción debe estar en:

```text
status = completed
shippingStatus = paid
```

La cancelación:

- cambia el pago a `refunded`;
- conserva `shippingStatus = paid` y los datos históricos;
- restaura exactamente la cantidad comprada;
- reactiva el producto solo si no está eliminado, oculto o desactivado;
- decrementa `Seller.completedSalesCount`, sin bajar de cero;
- conserva los snapshots de comisión;
- notifica al buyer después del commit.

No se permite cancelar después de `shipped` o `delivered`. Una segunda
cancelación no restaura stock ni vuelve a decrementar métricas.

## 12. Disputes del comprador

```http
POST /payments/:id/dispute
```

Solo el buyer puede abrir un dispute. Requiere:

```text
payment.status = completed
shippingStatus = delivered
```

El motivo es obligatorio, se recorta y admite hasta 1000 caracteres. Existe
como máximo un dispute por transacción mediante una restricción única.

No se puede abrir un dispute para pagos `pending`, `failed`, `refunded`, ni
para pedidos en `paid` o `shipped`.

## 13. Estados de dispute

```text
open
resolved_refund
resolved_closed
```

## 14. Administración de disputes

Solo SUPERADMIN, con JWT y `SuperAdminGuard`, puede usar:

```http
GET /payments/disputes?page=1&limit=20
GET /payments/disputes/:id
PATCH /payments/disputes/:id/resolve
```

La resolución recibe:

```json
{
  "action": "refund",
  "resolution": "Resolución administrativa"
}
```

`action` puede ser `refund` o `close`.

## 15. Refund administrativo

Con `action = refund`:

- el pago pasa a `refunded`;
- el dispute pasa a `resolved_refund`;
- no se restaura el stock;
- se conserva el historial de envío;
- `completedSalesCount` disminuye una vez, sin bajar de cero;
- se registra `payment_dispute_refunded` en `ModerationAction`;
- se emite la notificación correspondiente después del commit.

No se permite resolver nuevamente un dispute ya resuelto.

## 16. Cierre de dispute

Con `action = close`:

- el pago permanece `completed`;
- el dispute pasa a `resolved_closed`;
- no se modifica el stock;
- no cambia `completedSalesCount`;
- se registra `payment_dispute_closed` en `ModerationAction`.

## 17. Reglas de stock

| Operación | Efecto sobre stock |
| --- | --- |
| Checkout aprobado | Decrementa la cantidad comprada una vez |
| Checkout rechazado por `shipsTo` | No modifica stock |
| Cancelación del seller | Restaura exactamente la cantidad comprada |
| Refund por dispute | No restaura stock |
| Cierre de dispute | No modifica stock |
| Operación duplicada | No aplica un segundo cambio |

El checkout usa actualización condicional y bloqueo pesimista del producto. La
cancelación bloquea la transacción, el producto y el seller.

## 18. Seller metrics

`Seller.completedSalesCount`:

- aumenta cuando checkout termina correctamente;
- disminuye en cancelación;
- disminuye en refund administrativo de un dispute;
- no cambia al cerrar un dispute;
- no cambia si `shipsTo` rechaza el checkout;
- nunca baja de cero.

## 19. Commission snapshots

Cada `PaymentTransaction` conserva los valores calculados en el momento del
checkout, incluyendo:

- `salesTierName`;
- `salesDiscount`;
- `priceTierName`;
- `priceDiscount`;
- `commissionRate`;
- `commissionAmount`;
- `sellerNet`;
- `exchangeRate`;
- `normalizedAmountCrc`.

Cancelaciones y refunds no recalculan ni modifican esos snapshots.

## 20. Historial de compras

```http
GET /payments/me/purchases
```

Incluye transacciones `completed` y `refunded`. Cada ítem expone
`paymentStatus` y `shippingStatus`, además de la información histórica del
producto necesaria para el listado.

No incluye la dirección completa, tracking ni carrier.

## 21. Historial de ventas

```http
GET /payments/me/sales
```

Incluye transacciones `completed` y `refunded`, con `paymentStatus` y
`shippingStatus`.

No incluye la dirección completa, tracking ni carrier.

## 22. Receipt de la transacción

```http
GET /payments/:id
```

Solo puede consultarlo el buyer o seller autorizado de la transacción.

Incluye, cuando corresponde:

- estado del pago;
- `shippingStatus`;
- `shippingAddress`;
- `trackingNumber`;
- `carrier`;
- `shippedAt`;
- `deliveredAt`.

No expone información de tarjeta completa ni información de otros usuarios.

También incluye `dispute`: `null` si la transacción no tiene reclamo o un
objeto con `id`, `status`, `reason`, `resolution`, `resolutionNote`,
`createdAt` y `resolvedAt` cuando existe. Solo se exponen estos campos del
reclamo; no se incluyen actores administrativos ni datos duplicados.

## 23. Notifications

Las notificaciones de compra existentes incluyen:

- `purchase_completed`;
- `sale_completed`;
- `order_shipped` — enviada al buyer;
- `order_delivered` — enviada al seller;
- `order_cancelled` — enviada al buyer;
- `payment_refunded` — usada para refund administrativo.

Las notificaciones no contienen dirección, teléfono, notas de envío, números
de tarjeta, comisión ni tracking/carrier.

Los eventos se emiten después del commit cuando la operación depende de una
transacción. Un fallo de notificación no revierte una transición comercial ya
confirmada.

## 24. ModerationAction para disputes

Los refunds y cierres administrativos generan eventos append-only:

- `targetType = payment_dispute`, `action = payment_dispute_refunded`;
- `targetType = payment_dispute`, `action = payment_dispute_closed`.

El `targetId` corresponde al id del dispute. No se registran cancelaciones,
ship ni deliver como acciones de moderación.

## 25. Review eligibility

La elegibilidad para reviews continúa basada en el pago `completed`. Esta
implementación no cambia `canReview` ni elimina reviews existentes.

Una transacción `refunded` no habilita una nueva review.

## 26. Transacciones históricas

Las transacciones antiguas pueden tener:

```json
{
  "shippingStatus": null,
  "trackingNumber": null,
  "carrier": null,
  "shippedAt": null,
  "deliveredAt": null
}
```

No se infiere automáticamente `paid`. Por ello, una transacción histórica sin
estado de envío o sin dirección no puede usar correctamente los flujos nuevos
de ship, deliver o dispute.

## 27. Concurrencia

Las transiciones críticas utilizan transacciones y locks pesimistas:

- checkout bloquea el producto y el seller;
- ship y deliver bloquean la transacción;
- cancelación bloquea transacción, producto y seller;
- resolución de dispute bloquea dispute, transacción y seller.

Esto evita doble descuento, doble restauración, doble refund y dobles cambios
de métricas.

Si ship y cancel compiten, el lock serializa las operaciones: solo una puede
aplicar una transición válida. Una operación que observe el estado posterior
responde `409`.

## 28. Resumen de endpoints

| Método | Ruta | Actor | Condición principal |
| --- | --- | --- | --- |
| POST | `/payments/checkout` | Buyer | Producto vendible, destino permitido, stock y pago aprobados |
| GET | `/payments/quote/:productId` | Usuario autenticado | Producto cotizable y stock suficiente |
| GET | `/payments/:id` | Buyer/Seller | Debe estar autorizado en la transacción |
| PATCH | `/payments/:id/ship` | Seller | Pago `completed`, envío `paid`, dirección existente |
| PATCH | `/payments/:id/deliver` | Buyer | Pago `completed`, envío `shipped` |
| POST | `/payments/:id/cancel` | Seller | Pago `completed`, envío `paid` |
| POST | `/payments/:id/dispute` | Buyer | Pago `completed`, envío `delivered` |
| GET | `/payments/me/purchases` | Buyer | Lista propia de compras |
| GET | `/payments/me/sales` | Seller | Lista propia de ventas |
| GET | `/payments/me/sales/summary` | Seller | Resumen propio de ventas |
| GET | `/payments/disputes` | SUPERADMIN | Listado administrativo paginado |
| GET | `/payments/disputes/:id` | SUPERADMIN | Detalle administrativo |
| PATCH | `/payments/disputes/:id/resolve` | SUPERADMIN | Dispute en estado `open` |

## 29. Transiciones válidas

| Operación | Estado requerido | Estado resultante |
| --- | --- | --- |
| Checkout aprobado | `payment: pending` | `payment: completed`, `shipping: paid` |
| Ship | `completed + paid` | `completed + shipped` |
| Deliver | `completed + shipped` | `completed + delivered` |
| Cancel | `completed + paid` | `refunded + paid` |
| Dispute refund | `completed + delivered` | `refunded + delivered` |
| Dispute close | `completed + delivered` | `completed + delivered` |

No se implementan transiciones de cancelación después de `shipped` ni de
dispute antes de `delivered`.

## 30. Errores importantes

- **400 Bad Request:** DTO inválido, tarjeta inválida, cantidad o datos de
  entrada incorrectos.
- **401 Unauthorized:** falta autenticación JWT o la sesión no es válida.
- **402 Payment Required:** el gateway rechaza el pago.
- **403 Forbidden:** el actor no es el buyer, seller o SUPERADMIN autorizado.
- **404 Not Found:** producto, transacción o dispute inexistente.
- **409 Conflict:** stock insuficiente, destino no permitido, estado inválido,
  operación duplicada o conflicto de idempotencia.
- **503 Service Unavailable:** gateway o servicio externo no disponible.

## 31. Notas de seguridad

- Las notifications no incluyen PII de envío ni datos completos de tarjeta.
- Solo se conservan marca, últimos cuatro dígitos y nombre del titular cuando
  corresponde al pago aprobado.
- `shippingAddress` completo solo aparece en el receipt para buyer/seller
  autorizado.
- Los listados de compras y ventas no exponen dirección, tracking ni carrier.
- Los endpoints administrativos de disputes requieren JWT y
  `SuperAdminGuard`.

## 32. Fuera del alcance actual

No forman parte del flujo actual documentado:

- shipping cost;
- devoluciones físicas;
- payment hold hasta la entrega;
- SLA o `expectedDeliveryAt`;
- cancelación después del envío;
- refund automático del gateway;
- dispute adicional por transacción.
