# Guía frontend: pagos, checkout, comisiones e historiales

Esta guía describe cómo probar y renderizar en el frontend las funcionalidades de pagos actualmente disponibles en Mynted.

## 1. URL base y autenticación

En desarrollo, el backend normalmente se ejecuta en:

```text
http://localhost:3000
```

La documentación interactiva está disponible en:

```text
http://localhost:3000/api
```

La mayoría de los endpoints de pagos requieren autenticación JWT.

El login establece las cookies `access_token` y `refresh_token` como cookies `httpOnly`. Desde el navegador, las peticiones deben incluir credenciales:

```ts
fetch(`${API_URL}/payments/quote/42`, {
  credentials: 'include',
});
```

Si el frontend trabaja con un token Bearer, debe enviarlo así:

```http
Authorization: Bearer <access_token>
```

En Axios:

```ts
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
});
```

El access token tiene una vida corta. Ante un `401`, el frontend debe intentar renovar la sesión mediante `POST /auth/refresh` y, si falla, redirigir al login.

## 2. Monedas soportadas

La plataforma soporta únicamente estas monedas:

```text
AOA ARS BRL CHF CLP COP CRC EUR GTQ HNL KRW MXN MZN NIO PEN USD
```

Las monedas se normalizan a mayúsculas. `EUR`, `MXN`, `CRC` y `USD` son válidas. `GBP`, `CAD`, `JPY` y `XYZ` deben tratarse como no soportadas y producen `400`.

Reglas de conversión:

| Par | Proveedor |
|---|---|
| Misma moneda | No consulta ningún proveedor; tasa `1` |
| USD → CRC | BCCR |
| CRC → USD | BCCR, invirtiendo la tasa USD → CRC |
| Cualquier otro par soportado | Frankfurter |

El frontend no necesita seleccionar el proveedor. El backend lo decide automáticamente.

## 3. Flujo recomendado de compra

El flujo recomendado es:

1. Mostrar el detalle del producto.
2. Consultar una cotización con `GET /payments/quote/:productId`.
3. Mostrar el monto original, la comisión si corresponde y el equivalente en la moneda del usuario.
4. Pedir los datos de tarjeta.
5. Ejecutar `POST /payments/checkout` con una clave de idempotencia única.
6. Mostrar el resultado aprobado o el motivo del rechazo.
7. Actualizar la disponibilidad del producto usando la respuesta del checkout o refrescando el detalle.

La cotización es informativa. El monto definitivo siempre se calcula nuevamente durante el checkout.

## 4. Cotización de producto

### Request

```http
GET /payments/quote/42
Authorization: Bearer <access_token>
```

Ejemplo con `fetch`:

```ts
const response = await fetch(`${API_URL}/payments/quote/42`, {
  credentials: 'include',
});

const quote = await response.json();
```

### Response: producto en la misma moneda

```json
{
  "productId": 42,
  "amount": 120000,
  "currency": "CRC",
  "commission": {
    "rate": 0.03,
    "amount": 3600,
    "sellerNet": 116400,
    "salesTierName": "Oro",
    "priceTierName": "Alto",
    "salesDiscount": 0.01,
    "priceDiscount": 0.01
  }
}
```

`commission` se incluye cuando el usuario autenticado es el vendedor del producto. Para un comprador normal puede no aparecer.

### Response: producto con conversión para el comprador

```json
{
  "productId": 42,
  "amount": 120000,
  "currency": "CRC",
  "convertedAmount": {
    "amount": 232.15,
    "currency": "EUR",
    "exchangeRate": 0.001934,
    "rateDate": "2026-10-20"
  }
}
```

Importante:

- `amount` y `currency` son los originales del producto.
- `convertedAmount` es una referencia visual para el comprador.
- El checkout cobra el monto y la moneda originales del producto.
- La comisión se calcula en la moneda original del producto.

## 5. Checkout / pasarela simulada

Endpoint:

```http
POST /payments/checkout
```

Headers obligatorios:

```http
Authorization: Bearer <access_token>
Idempotency-Key: checkout-product-42-unique-001
Content-Type: application/json
```

La clave `Idempotency-Key` debe tener entre 8 y 128 caracteres. Debe ser única por intento lógico de compra. Si el usuario reintenta la misma operación por un timeout, debe reutilizar la misma clave.

### Body

```json
{
  "productId": 42,
  "card": {
    "cardNumber": "4242424242424242",
    "expiryMonth": 12,
    "expiryYear": 2027,
    "cvv": "123",
    "cardHolderName": "María José Núñez"
  }
}
```

Validaciones:

- `productId`: entero mayor que cero;
- `cardNumber`: texto no vacío y número de tarjeta válido para la pasarela simulada;
- `expiryMonth`: entero de `1` a `12`;
- `expiryYear`: año de cuatro dígitos y fecha futura o actual;
- `cvv`: texto de 3 o 4 dígitos;
- `cardHolderName` (**obligatorio**): nombre del titular como aparece en la tarjeta. El backend lo normaliza antes de validar: recorta los espacios de los extremos y colapsa los espacios repetidos (`"  María   José "` → `"María José"`). Debe tener entre 2 y 80 caracteres, empezar con una letra y solo puede contener letras (con tildes, `ñ`, `ü`), espacios, apóstrofes (`'` o `’`), guiones y puntos. Se guardan las mayúsculas y minúsculas tal como se envían.

Errores de `cardHolderName` (`400`, en `message`):

- `El nombre del titular es obligatorio` (falta, está vacío o solo tiene espacios);
- `El nombre del titular debe tener entre 2 y 80 caracteres`;
- `El nombre del titular solo puede contener letras, espacios, apóstrofes, guiones y puntos`.

Los mensajes nunca repiten el valor enviado. El nombre del titular no cambia el resultado de la pasarela simulada: aprobación o rechazo dependen solo del número de tarjeta.

### Tarjetas simuladas

| Número | Resultado |
|---|---|
| `4242424242424242` | Aprobada |
| `4000000000000002` | Rechazada: `card_declined` |
| `4000000000009995` | Rechazada: `insufficient_funds` |
| `4000000000000069` | Rechazada: `expired_card` |

Para probar la tarjeta expirada simulada, la fecha enviada debe ser formalmente válida y futura. La pasarela decide el resultado por el número de tarjeta.

### Response aprobada: `201` o `200` según configuración HTTP

```json
{
  "id": "8c9e4e3c-8e8d-4ec2-a9e2-6f0f0d4c1a11",
  "status": "completed",
  "amount": 120000,
  "currency": "CRC",
  "commission": {
    "salesTierName": "Oro",
    "salesDiscount": 0.01,
    "priceTierName": "Alto",
    "priceDiscount": 0.01,
    "commissionRate": 0.03,
    "commissionAmount": 3600,
    "sellerNet": 116400,
    "exchangeRate": null,
    "normalizedAmountCrc": null
  },
  "gatewayReference": "SIM-A1B2C3",
  "cardBrand": "visa",
  "cardLast4": "4242",
  "cardHolderName": "María José Núñez",
  "failureReason": null,
  "completedAt": "2026-10-20T22:30:00.000Z"
}
```

El frontend solo debe mostrar `cardBrand`, `cardLast4` y `cardHolderName`. Nunca debe mostrar ni guardar el PAN completo, el CVV ni la fecha completa de expiración.

`cardHolderName` (como `cardBrand` y `cardLast4`) solo se guarda cuando el pago se aprueba. **Las transacciones creadas antes de este campo lo traen en `null`**: el frontend debe tolerarlo (por ejemplo, mostrar solo `Visa •••• 4242`).

### Rechazo de tarjeta: `402 Payment Required`

```json
{
  "statusCode": 402,
  "transactionId": "8c9e4e3c-8e8d-4ec2-a9e2-6f0f0d4c1a11",
  "failureReason": "card_declined"
}
```

Valores posibles de `failureReason`:

- `card_declined`;
- `insufficient_funds`;
- `expired_card`.

Un rechazo no significa un error técnico. El frontend debe mostrar un mensaje específico y permitir que el usuario intente nuevamente con otra tarjeta y otra clave de idempotencia.

### Tarjeta inválida: `400`

Una tarjeta inválida produce `400`. Ejemplos: número inválido por Luhn, expiración inválida o CVV inválido.

La respuesta no debe incluir PAN ni CVV. El frontend puede mostrar un mensaje genérico como:

```text
Los datos de la tarjeta son inválidos.
```

### Error técnico de la pasarela: `503`

Si la pasarela no está disponible, el backend responde con un error seguro. El frontend debe mostrar:

```text
No pudimos procesar el pago en este momento. Intenta nuevamente.
```

No se debe presentar como un rechazo definitivo de la tarjeta.

### Idempotencia

Una misma clave no debe reutilizarse para otro producto o comprador.

Comportamiento esperado:

- operación `completed`: devuelve el resultado completado sin cobrar nuevamente;
- operación `failed`: devuelve nuevamente el rechazo sin cobrar nuevamente;
- operación `pending`: responde conflicto mientras continúa pendiente;
- operación `refunded`: no puede reutilizarse;
- misma clave con otro producto o comprador: conflicto `409`.

Ejemplo de generación en frontend:

```ts
const idempotencyKey = crypto.randomUUID();
```

Para reintentar la misma solicitud debido a una respuesta perdida, conservar la misma clave. Para una nueva compra o un nuevo intento de pago, generar otra.

## 6. Consultar recibo

```http
GET /payments/{transactionId}
Authorization: Bearer <access_token>
```

Ejemplo:

```http
GET /payments/8c9e4e3c-8e8d-4ec2-a9e2-6f0f0d4c1a11
```

La respuesta incluye producto, vendedor, monto, moneda, fecha, `cardLast4`, referencia del gateway y, si quien consulta es el vendedor, el detalle de comisión.

Si quien consulta es el **comprador**, incluye además `cardHolderName` (`null` en transacciones anteriores a este campo). Si quien consulta es el **vendedor**, el campo **no viene**: el nombre del titular es un dato personal del comprador.

Nunca contiene el número completo de tarjeta ni el CVV.

## 7. Historial de compras

```http
GET /payments/me/purchases?page=1&limit=10
Authorization: Bearer <access_token>
```

Response:

```json
{
  "data": [
    {
      "id": "8c9e4e3c-8e8d-4ec2-a9e2-6f0f0d4c1a11",
      "product": {
        "id": 42,
        "title": "Cámara vintage",
        "imageUrl": "https://example.com/camera.jpg"
      },
      "seller": {
        "sellerId": 7,
        "displayName": "María"
      },
      "amount": 120000,
      "currency": "CRC",
      "completedAt": "2026-10-20T22:30:00.000Z",
      "cardLast4": "4242",
      "cardHolderName": "María José Núñez",
      "gatewayReference": "SIM-A1B2C3"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "totalPages": 1
  }
}
```

`page` empieza en `1`; `limit` acepta valores entre `1` y `100`. `cardHolderName` puede ser `null` en compras anteriores a este campo.

## 8. Historial de ventas

Solo está disponible para usuarios vendedores:

```http
GET /payments/me/sales?page=1&limit=10
Authorization: Bearer <access_token>
```

Cada venta incluye:

```json
{
  "id": "8c9e4e3c-8e8d-4ec2-a9e2-6f0f0d4c1a11",
  "completedAt": "2026-10-20T22:30:00.000Z",
  "product": {
    "id": 42,
    "title": "Cámara vintage",
    "imageUrl": null
  },
  "buyer": {
    "id": "user-uuid",
    "username": "buyer01",
    "photoUrl": null
  },
  "amount": 120000,
  "currency": "CRC",
  "salesTierName": "Oro",
  "priceTierName": "Alto",
  "commissionRate": 0.03,
  "commissionAmount": 3600,
  "sellerNet": 116400
}
```

Para renderizar una venta se recomienda mostrar:

```text
Venta: CRC 120,000
Comisión: CRC 3,600
Neto recibido: CRC 116,400
```

La moneda debe renderizarse usando el campo `currency` de cada registro; no asumir siempre CRC.

## 9. Resumen de ventas

```http
GET /payments/me/sales/summary
GET /payments/me/sales/summary?from=2026-01-01&to=2026-01-31
Authorization: Bearer <access_token>
```

Las fechas deben usar exactamente `YYYY-MM-DD`. `from` y `to` son opcionales, pero si ambas existen, `from` no puede ser posterior a `to`.

Response:

```json
{
  "currency": "EUR",
  "period": {
    "from": "2026-01-01",
    "to": "2026-01-31"
  },
  "totals": {
    "gross": 1200.5,
    "commissions": 36.02,
    "net": 1164.48
  },
  "breakdown": [
    {
      "currency": "CRC",
      "gross": 650000,
      "commissions": 19500,
      "net": 630500,
      "transactionCount": 5
    },
    {
      "currency": "USD",
      "gross": 500,
      "commissions": 15,
      "net": 485,
      "transactionCount": 2
    }
  ],
  "approximate": true
}
```

Interpretación:

- `totals` está expresado en la moneda configurada del usuario vendedor;
- `breakdown` conserva la moneda original de cada grupo de ventas;
- `approximate=true` indica que fue necesario convertir alguna transacción;
- las conversiones históricas usan la fecha de la transacción.

## 10. Comisión del vendedor

### Perfil de comisión

```http
GET /sellers/me/commission
Authorization: Bearer <access_token>
```

Este endpoint requiere usuario autenticado y vendedor. Devuelve:

- moneda del usuario;
- cantidad de ventas completadas;
- tier actual y siguiente;
- ventas restantes para el siguiente tier;
- tiers de precio;
- matriz de tasas.

### Estimación para publicar un producto

```http
GET /sellers/me/commission/estimate?amount=120000
Authorization: Bearer <access_token>
```

Response:

```json
{
  "amount": 120000,
  "currency": "CRC",
  "commissionRate": 0.03,
  "commissionAmount": 3600,
  "sellerNet": 116400,
  "salesTierName": "Oro",
  "priceTierName": "Alto",
  "salesDiscount": 0.01,
  "priceDiscount": 0.01
}
```

Validaciones de `amount`:

- requerido;
- numérico y finito;
- mayor que cero;
- máximo dos decimales.

La moneda se obtiene de `user.currency`; no se envía como query param. Este endpoint no crea productos, no cobra, no crea transacciones y no llama a la pasarela.

## 11. Catálogo público de tiers

```http
GET /commission-tiers?currency=CRC
```

Ejemplo:

```json
{
  "currency": "EUR",
  "salesTiers": [
    {
      "name": "Bronce",
      "minValue": 0,
      "maxValue": 10,
      "discount": 0
    },
    {
      "name": "Plata",
      "minValue": 10,
      "maxValue": 50,
      "discount": 0.005
    }
  ],
  "priceTiers": [
    {
      "name": "Estándar",
      "minValue": 0,
      "maxValue": 48.5,
      "discount": 0,
      "currency": "EUR",
      "approximate": true
    }
  ]
}
```

Los rangos usan `[minValue, maxValue)`: incluyen el mínimo y excluyen el máximo.

Ejemplo:

- `0 <= amount < 25000`: tier CRC inicial;
- `amount = 25000`: ya pertenece al tier siguiente;
- `maxValue: null`: rango abierto sin límite superior.

Si la moneda tiene tiers propios, `approximate=false`. Si se muestran tiers CRC convertidos a otra moneda, `approximate=true`.

## 12. Renderizado recomendado

### Selector de moneda y formato

No asumir que todos los montos son CRC. Usar siempre el código recibido:

```ts
const formatted = new Intl.NumberFormat('es-CR', {
  style: 'currency',
  currency: item.currency,
}).format(item.amount);
```

Si el navegador no soporta algún código de la lista, mostrar el código junto al monto como fallback:

```ts
`${item.currency} ${item.amount.toFixed(2)}`
```

### Estados de checkout

El componente de pago debería contemplar al menos:

```text
idle
submitting
approved
declined
invalid_card
technical_error
conflict
```

Durante `submitting`:

- deshabilitar el botón de pagar;
- evitar doble envío;
- conservar la clave de idempotencia del intento.

Para `402`, mostrar el mensaje asociado a `failureReason`. Para `400`, revisar los campos de tarjeta. Para `503`, permitir reintentar sin cambiar necesariamente los datos de tarjeta. Para `409`, consultar el estado del checkout o mostrar que la operación ya está en proceso.

### Comisión

Mostrar siempre que esté disponible:

```text
Comisión: {commissionAmount} {currency}
Recibirás aproximadamente: {sellerNet} {currency}
Tasa: {commissionRate * 100}%
```

`commissionRate` llega como decimal. Por ejemplo, `0.03` significa `3%`.

## 13. Seguridad y datos sensibles

No guardar en localStorage, sessionStorage, logs ni analytics:

- número completo de tarjeta;
- CVV;
- objeto `card` completo;
- tokens de autenticación si la arquitectura usa cookies httpOnly.

El backend solo devuelve `cardBrand`, `cardLast4`, `cardHolderName` (solo al comprador) y una referencia simulada como `SIM-A1B2C3`. El historial de ventas del vendedor no incluye datos de tarjeta del comprador.

## 14. Checklist de prueba manual

### Compra aprobada

1. Iniciar sesión como comprador.
2. Elegir un producto activo de tipo venta.
3. Ejecutar `GET /payments/quote/:productId`.
4. Ejecutar checkout con `4242424242424242`.
5. Confirmar `status=completed`.
6. Confirmar `gatewayReference` con formato `SIM-XXXXXX`.
7. Confirmar `cardLast4=4242` y `cardHolderName` con el nombre enviado (sin espacios repetidos).
8. Confirmar que el producto deje de estar disponible.

### Compra rechazada

Usar una de las tarjetas simuladas de rechazo y confirmar:

- respuesta HTTP `402`;
- `failureReason` correcto;
- no se crea una segunda operación al repetir la misma clave;
- el producto sigue disponible.

### Conversión multimoneda

Probar al menos:

- producto CRC y usuario EUR;
- producto EUR y usuario CRC;
- producto EUR y usuario USD;
- producto CRC y usuario USD;
- producto USD y usuario CRC.

Verificar que `convertedAmount` sea solo informativo y que `amount/currency` del producto no cambien.

### Historial

Después de una compra aprobada:

1. Consultar `/payments/me/purchases` como comprador.
2. Consultar `/payments/me/sales` como vendedor.
3. Consultar `/payments/me/sales/summary` como vendedor.
4. Consultar `/payments/{transactionId}` como comprador o vendedor.

## 15. Errores frecuentes

| HTTP | Significado | Acción frontend |
|---:|---|---|
| 400 | Body, tarjeta, moneda o query inválida | Mostrar validación y corregir datos |
| 401 | Sesión ausente o expirada | Renovar sesión o ir al login |
| 402 | Tarjeta rechazada | Mostrar `failureReason` |
| 403 | Usuario no autorizado o no vendedor | Ocultar acción/no permitir acceso |
| 404 | Producto o transacción inexistente | Mostrar recurso no encontrado |
| 409 | Producto no disponible o conflicto de idempotencia | Refrescar estado y evitar doble envío |
| 503 | Provider o pasarela temporalmente no disponible | Permitir reintento seguro |

## 16. Referencia rápida

```text
GET  /payments/quote/:productId
POST /payments/checkout
GET  /payments/:id
GET  /payments/me/purchases?page=1&limit=10
GET  /payments/me/sales?page=1&limit=10
GET  /payments/me/sales/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
GET  /sellers/me/commission
GET  /sellers/me/commission/estimate?amount=...
GET  /commission-tiers?currency=CRC
```

Para probar todos los contratos y ejemplos disponibles, usar Swagger en `/api` con un backend levantado y una sesión autenticada.
