# Guía de Mynted Pro para el frontend

Cómo mostrar y vender el plan **Pro**: planes, pago, renovación, estado de la suscripción, el badge, los cosméticos de perfil y el banner propio.

**Idea clave:**
- Hay **un solo plan Pro** con tres periodos: `monthly` (1 mes), `semiannual` (6 meses) y `annual` (12 meses).
- La renovación es **manual**: no hay cobro automático. Pagar de nuevo extiende el tiempo.
- El plan gratuito **no pierde nada**. Pro solo agrega extras.
- Eres Pro **mientras `endsAt` sea futuro**. El estado no se guarda: si vence, simplemente dejas de ser Pro (sin jobs ni pasos intermedios). El backend lo calcula en cada respuesta.
- Los usuarios gratuitos siguen pudiendo equipar los cosméticos gratuitos.

Todas las rutas con sesión usan la cookie `access_token`, como el resto de la API.

---

## 1. Planes y precios

`GET /subscriptions/plans` — público (con o sin sesión).

```json
{
  "plan": "pro",
  "plans": [
    { "period": "monthly",    "months": 1,  "amount": 4.99,  "currency": "USD", "displayAmount": 2495,  "displayCurrency": "CRC", "savingsPercent": 0 },
    { "period": "semiannual", "months": 6,  "amount": 24.99, "currency": "USD", "displayAmount": 12495, "displayCurrency": "CRC", "savingsPercent": 17 },
    { "period": "annual",     "months": 12, "amount": 41.99, "currency": "USD", "displayAmount": 20995, "displayCurrency": "CRC", "savingsPercent": 30 }
  ]
}
```

- **`amount` / `currency`**: lo que se **cobra**, siempre en **USD**.
- **`displayAmount` / `displayCurrency`**: el mismo precio convertido a la moneda del usuario. Es **informativo**. Sigue la misma regla que los productos: header `X-Display-Currency` → `displayCurrency` del usuario → su `currency` → `CRC` (ver la [guía de moneda](GUIA_MONEDA_FRONTEND.md)).
- **Si no hay tipo de cambio**, `displayAmount` es `null`: muestra `amount` en USD. Nunca falla el endpoint por eso.
- **`savingsPercent`**: ahorro frente a pagar el plan mensual durante los mismos meses (entero; `0` en el mensual). Puedes mostrar "Ahorra 30 %".

---

## 2. Pagar (y renovar)

`POST /subscriptions/checkout` — con sesión.

Headers: `Idempotency-Key` (**obligatorio**, de 8 a 128 caracteres) y, opcional, `X-Display-Currency`.

```json
{
  "period": "annual",
  "card": {
    "cardNumber": "4242424242424242",
    "expiryMonth": 12,
    "expiryYear": 2027,
    "cvv": "123",
    "cardHolderName": "María José Núñez"
  }
}
```

La tarjeta usa las mismas reglas y el mismo formulario que el pago de productos (ver la [guía de pagos](GUIA_FRONTEND_PAGOS.md)). La pasarela es simulada. Tarjetas de prueba: `4242424242424242` aprueba, `4000000000000002` rechaza (`card_declined`), `4000000000009995` da fondos insuficientes (`insufficient_funds`) y `4000000000000069` da tarjeta vencida (`expired_card`).

**Respuesta aprobada (`201`):**

```json
{
  "id": "dba77847-6f8a-422a-be4d-f03af1362b10",
  "status": "completed",
  "period": "annual",
  "amount": 41.99,
  "currency": "USD",
  "displayAmount": 20995,
  "displayCurrency": "CRC",
  "exchangeRate": 500,
  "gatewayReference": "SIM-54EC9D",
  "cardBrand": "visa",
  "cardLast4": "4242",
  "cardHolderName": "María José Núñez",
  "failureReason": null,
  "coversFrom": "2026-10-26T18:52:14.247Z",
  "coversUntil": "2027-10-26T18:52:14.247Z",
  "createdAt": "2026-10-26T18:52:13.234Z"
}
```

`coversFrom` / `coversUntil` son el tramo que cubre ese pago. Después del pago, vuelve a pedir `GET /subscriptions/me` para refrescar el estado.

### Idempotency-Key

Genera **una clave nueva por intento de pago del usuario** (por ejemplo un UUID al abrir el formulario) y **reutilízala solo si reintentas el mismo pago** (doble clic, red caída, respuesta perdida):

| Situación | Resultado |
|---|---|
| Misma clave, pago ya aprobado | `201` con la **misma respuesta**, sin cobrar ni extender de nuevo |
| Misma clave, pago ya rechazado | `402` con el mismo motivo, sin volver a cobrar |
| Misma clave con otro periodo (o de otro usuario) | `409` |
| Dos peticiones simultáneas con la misma clave | se cobra **una sola vez**; ambas reciben el mismo resultado |

**Tras un rechazo (`402`) usa una clave nueva** para intentar con otra tarjeta: la clave anterior siempre repetirá el rechazo.

### Errores

| Código | Cuándo | Qué mostrar |
|---|---|---|
| `400` | `Idempotency-Key` ausente o fuera de 8–128 caracteres; periodo desconocido; datos de tarjeta inválidos (número, vencimiento, CVV, titular) | corregir el formulario |
| `401` | sin sesión | ir a iniciar sesión |
| `402` | pago rechazado. Cuerpo: `{ "statusCode": 402, "paymentId": "…", "failureReason": "card_declined" }` | mensaje según `failureReason`: `card_declined`, `insufficient_funds` o `expired_card` |
| `409` | la clave pertenece a otra operación | generar otra clave |
| `503` | la pasarela no está disponible | reintentar más tarde (no se cobró) |

Un pago rechazado **no cambia** la suscripción.

---

## 3. Estado de la suscripción

`GET /subscriptions/me` — con sesión.

```json
{
  "isPro": true,
  "status": "active",
  "period": "annual",
  "startsAt": "2026-10-26T18:52:14.247Z",
  "endsAt": "2027-10-26T18:52:14.247Z",
  "cancelAtPeriodEnd": false,
  "daysRemaining": 365
}
```

Sin suscripción nunca pagada: `{ "isPro": false, "status": "none", "period": null, "startsAt": null, "endsAt": null, "cancelAtPeriodEnd": false, "daysRemaining": 0 }`.

| `status` | Significa | `isPro` | Qué mostrar |
|---|---|---|---|
| `none` | nunca pagó | `false` | planes y botón "Hazte Pro" |
| `active` | vigente | `true` | "Pro hasta el {endsAt}" y botón para renovar antes |
| `cancelled` | vigente, pero canceló (`cancelAtPeriodEnd`) | `true` | "Tu Pro termina el {endsAt}" y botón para pagar de nuevo. **Sigue siendo Pro hasta `endsAt`** |
| `expired` | `endsAt` ya pasó | `false` | "Tu Pro venció el {endsAt}" y botón para renovar |

`daysRemaining` redondea hacia arriba (queda `1` mientras falte algo del último día) y es `0` si no está vigente.

---

## 4. Renovación y cancelación

**No hay cobro automático.** Para renovar, el usuario vuelve a pagar con `POST /subscriptions/checkout`. Las fechas se calculan así:

- **Con Pro vigente**: se suma el periodo **desde el `endsAt` actual** (no se pierde ningún día). `startsAt` no cambia.
- **Con Pro vencido**: se suma desde **ahora** y `startsAt` pasa a ser ahora.
- **Meses de calendario**, con el día ajustado al último día del mes: 31 de enero + 1 mes = 28 (o 29) de febrero. El día se cuenta en la hora de Costa Rica.
- Se puede **cambiar de periodo** al renovar (por ejemplo, de mensual a anual): se suma el periodo que pagó.
- **Pagar después de cancelar** limpia la cancelación.

`POST /subscriptions/cancel` — con sesión. No devuelve el dinero ni corta el acceso: solo marca `cancelAtPeriodEnd: true`, y sigue siendo Pro hasta `endsAt`. Responde `200` con el mismo cuerpo de `GET /subscriptions/me` (`status: "cancelled"`). Repetirlo no falla. Si no hay suscripción vigente responde `409`. Como la renovación ya es manual, cancelar sirve para dejar constancia y para adaptar los avisos (ver notificaciones).

---

## 5. Historial de pagos

`GET /subscriptions/me/payments?page=1&limit=10` — con sesión. Más reciente primero; incluye los pagos rechazados.

```json
{
  "data": [ { "id": "…", "status": "failed", "period": "monthly", "amount": 4.99, "currency": "USD", "failureReason": "card_declined", "coversFrom": null, "coversUntil": null, "createdAt": "…" } ],
  "pagination": { "page": 1, "limit": 10, "total": 3, "totalPages": 1 }
}
```

Cada ítem tiene los mismos campos que la respuesta del pago (`status` es `completed` o `failed`).

---

## 6. `isPro` en cada superficie

`isPro` es un booleano **agregado** junto a los campos existentes (no cambió ninguno). Úsalo para pintar el badge o el distintivo.

| Dónde | Campo |
|---|---|
| `GET /users/me` | `isPro` |
| Perfil público (`GET /users/:id`, `GET /users/by-username/:username`) y búsqueda de usuarios (`GET /users/search`, `GET /search?type=users`) | `isPro` en cada usuario |
| Tienda: `GET /sellers/:sellerId` y `GET /search?type=stores` | `isPro` (del dueño de la tienda) |
| Tarjetas de `GET /products/shop` | `seller.isPro` |
| Detalle `GET /products/:id` | `seller.isPro` |
| Reputación `GET /profiles/:id/reputation` | `isPro` (también si no es vendedor) |
| Chat: bandeja `GET /conversations` y `conversation` de `GET /conversations/:id/messages` | `otherParticipant.isPro` |

Los listados de productos que no traen objeto `seller` (`GET /products`, relacionados, recomendados, productos de una tienda) **no cambian**.

---

## 7. El badge `pro`

Aparece en `GET /users/:userId/badges`, `GET /users/me/badges` y en `badges` de la reputación, **mientras la suscripción esté vigente**:

```json
{ "code": "pro", "name": "Pro", "description": "Tiene Mynted Pro activo.", "scope": "user", "rarity": "epic", "awardedAt": null, "derived": true }
```

- Es **derivado** (`derived: true`, `awardedAt: null`): no se otorga ni se guarda; aparece y desaparece solo con `endsAt`.
- Una suscripción **cancelada** conserva el badge hasta `endsAt`.
- El ícono se asocia por `code` (`"pro"`), como los demás badges. `GET /badges?scope=user` lo incluye en el catálogo con `derived: true`.

---

## 8. Cosméticos de perfil

Hay tres tipos: **banner** (`banner`), **skin del ganso** (`goose_skin`) y **marco** (`frame`). Cada cosmético tiene un `code` **estable** y un flag `proOnly`:

- Los **gratuitos** (`proOnly: false`) los puede equipar cualquier usuario.
- Los **Pro** (`proOnly: true`) solo se aplican con Pro vigente.
- Cada tipo tiene un **valor por defecto** (`isDefault: true`), que es lo que se muestra cuando no hay nada equipado o lo equipado no aplica.

### Catálogo

`GET /cosmetics` — público.

```json
[
  { "id": 1, "code": "banner_default", "type": "banner", "name": "Banner por defecto", "assetUrl": null, "proOnly": false, "isDefault": true, "sortOrder": 0 },
  { "id": 3, "code": "banner_aurora",  "type": "banner", "name": "Aurora", "assetUrl": null, "proOnly": true, "isDefault": false, "sortOrder": 20 }
]
```

`assetUrl` es `null` cuando el recurso gráfico vive en el frontend: **mapea la imagen por `code`**. Si trae URL, úsala.

### Lo mío: equipado vs. efectivo

`GET /users/me/cosmetics` — con sesión.

```json
{
  "isPro": true,
  "equipped": {
    "banner": { "id": 3, "code": "banner_aurora" },
    "gooseSkin": { "id": 7, "code": "goose_ninja" },
    "frame": { "id": 11, "code": "frame_gold" },
    "useCustomBanner": false,
    "customBanner": null
  },
  "cosmetics": {
    "banner": { "source": "catalog", "code": "banner_aurora", "url": null, "staticUrl": null, "isAnimated": false },
    "gooseSkin": { "code": "goose_ninja", "assetUrl": null },
    "frame": { "code": "frame_gold", "assetUrl": null }
  }
}
```

- **`equipped`** es la **preferencia** guardada. No cambia al vencer Pro.
- **`cosmetics`** es lo que **se aplica ahora**. Pinta siempre `cosmetics`, nunca `equipped`.
- **`cosmetics.banner.source`**: `custom` (banner propio, Pro), `catalog` (uno del catálogo) o `default`.

### Equipar

`PUT /users/me/cosmetics` — con sesión. Solo cambia lo que envías.

```json
{ "bannerId": 3, "gooseSkinId": 7, "frameId": 11, "useCustomBanner": false }
```

- `null` en un campo deja ese tipo en su valor por defecto (`{ "bannerId": null }`).
- Elegir un banner (o `null`) **desactiva el banner propio**; no lo borra. Para volver a usarlo envía `useCustomBanner: true`.
- Responde `200` con el mismo cuerpo que `GET /users/me/cosmetics`.

| Código | Cuándo |
|---|---|
| `400` | cuerpo vacío o con campos desconocidos; el id es de otro tipo (un skin en `bannerId`); `useCustomBanner: true` sin haber subido un banner propio |
| `403` | cosmético Pro (o banner propio) sin Pro vigente |
| `404` | el cosmético no existe o está desactivado |

En el selector, muestra los `proOnly` con un candado a quien no es Pro y ofrece hacerse Pro en lugar de llamar al endpoint.

### Qué pasa al vencer y al renovar

- **Al vencer**: lo efectivo vuelve al valor por defecto (banner, skin y marco). **No se borra nada**: ni lo equipado ni el banner subido.
- **Al renovar**: todo se restablece **solo**, sin que el usuario vuelva a equipar nada.
- Un usuario con Pro vencido **puede** seguir equipando cosméticos **gratuitos**.

### Dónde viene `cosmetics`

`GET /users/me`, el perfil público (`GET /users/:id`, `by-username`), cada usuario de la búsqueda de usuarios y `GET /sellers/:sellerId` (junto al `bannerUrl`).

> **Hoy** el chat, los posts y los listados de productos **no** traen `cosmetics`. Cuando se agreguen, usarán el mismo objeto (con `staticUrl` para listados, chat y posts).

### La tienda

`GET /sellers/:sellerId` ahora devuelve `cosmetics` del dueño y `bannerUrl` pasa de `null` a la **URL del banner efectivo** del dueño: la del banner propio si es Pro y lo prefirió, o la `assetUrl` del banner del catálogo. Si el banner se mapea por `code` (`assetUrl: null`), `bannerUrl` es `null`: usa `cosmetics.banner.code`.

---

## 9. Banner propio (solo Pro)

Un usuario Pro puede subir su propio banner (imagen o GIF).

`PUT /users/me/banner` — `multipart/form-data`, campo **`banner`**.

- Formatos: JPEG, PNG, WEBP o GIF. **Máximo 8 MB** (la foto de perfil sigue en 5 MB).
- Queda como banner preferido (`useCustomBanner: true`). Si ya tenía uno, el anterior se **reemplaza** y se borra de Cloudinary.
- Responde `200` con el mismo cuerpo que `GET /users/me/cosmetics`.

| Código | Cuándo |
|---|---|
| `400` | falta el archivo, formato no permitido o la imagen está corrupta |
| `403` | sin Pro vigente |
| `413` | el archivo supera los 8 MB |

`DELETE /users/me/banner` — responde `204`. Quita el banner propio y lo borra. **No exige Pro** (se puede quitar aunque haya vencido) y repetirlo no falla.

### `url` vs. `staticUrl`

Cuando el banner efectivo es el propio, trae:

```json
{ "source": "custom", "code": null, "url": "https://res.cloudinary.com/…/banner.gif", "staticUrl": "https://res.cloudinary.com/…/banner.jpg", "isAnimated": true }
```

- **`url`**: la imagen tal cual (puede ser un GIF animado). Úsala **solo en el perfil**.
- **`staticUrl`**: el **primer fotograma** (JPEG) si es animado; si no, es igual a `url`. Úsala en **listados, chat y posts**, donde un GIF animado sería ruido.
- `isAnimated` te dice si hay animación.

Sin Pro vigente el banner propio no se aplica (`source` es `default` o `catalog`), aunque siga guardado.

---

## 10. Notificaciones

Los tres tipos nuevos llegan por el flujo normal de notificaciones (ver la [guía de notificaciones](GUIA_NOTIFICACIONES_FRONTEND.md)). Los montos van en USD y las fechas en ISO.

| `type` | Cuándo | `data` | Al tocarla, ir a |
|---|---|---|---|
| `subscription_payment_confirmed` | se aprueba un pago | `paymentId, period, amount, currency, startsAt, endsAt, renewal` | la pantalla de suscripción |
| `subscription_expiring_soon` | faltan 3 días o menos para `endsAt` | `subscriptionId, period, endsAt, daysRemaining, cancelAtPeriodEnd` | los planes, para renovar |
| `subscription_expired` | venció (hasta 7 días después) | `subscriptionId, period, endsAt` | los planes, para renovar |

- **`renewal`** (`subscription_payment_confirmed`): `true` si ya era Pro y se extendió; `false` si es el primer pago o volvió tras vencer.
- **`cancelAtPeriodEnd`** (`subscription_expiring_soon`): si es `true`, el usuario canceló. Adapta el texto: en lugar de "renueva para no perder tus beneficios", algo como "tu Pro termina el {endsAt}; paga de nuevo si quieres seguir".
- Cada vencimiento se avisa **una sola vez**. Si renueva (cambia `endsAt`) y más adelante vuelve a estar por vencer, avisa otra vez.
- Repetir un pago con la misma `Idempotency-Key` no vuelve a notificar.
- Los avisos de vencimiento los envía un proceso diario a las **2 AM de Costa Rica**.

---

## 11. Errores comunes

| Situación | Qué ves |
|---|---|
| Pagar sin `Idempotency-Key` | `400` |
| Tarjeta rechazada | `402` con `failureReason` |
| Equipar un cosmético Pro sin Pro | `403` |
| Subir banner sin Pro | `403` |
| Banner de más de 8 MB | `413` |
| Cancelar sin Pro vigente | `409` |
| Cualquier endpoint con sesión, sin sesión | `401` |

---

## 12. Pendiente (fuera de esta entrega)

- **Productos destacados** para vendedores aprobados Pro (hasta 3 activos, etiqueta "Destacado" y prioridad en los listados).
- **Reportes y moderación del banner propio.** Hoy **no existe** ningún mecanismo para reportar un banner ni para que un administrador lo remueva: queda como dependencia del módulo de moderación. Mientras tanto, el único control es el tipo y tamaño del archivo.
- Animaciones de perfil, estadísticas del vendedor, vitrina del perfil, descuento de comisión, prioridad en la búsqueda de tiendas y accesorios del ganso.

---

## Apéndice: agregar un cosmético (backend)

Los cosméticos se definen en `src/cosmetics/cosmetics.config.ts` (`BASE_COSMETICS`) y se siembran al arrancar. Para agregar uno basta una línea con un `code` **nuevo y estable** (el frontend mapea sus recursos por `code`), su tipo, `proOnly` y `sortOrder`. Debe haber **un solo valor por defecto por tipo** y no puede ser Pro. Para retirar uno, desactívalo en la base (`is_active = false`): deja de aparecer en el catálogo y quien lo tenía equipado vuelve al valor por defecto del tipo.
