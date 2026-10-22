# Guía de moneda para el frontend

Cómo mostrar los precios de los productos en la moneda de cada usuario y cómo dejar que la cambie en ajustes.

**Idea clave:** cada producto conserva su precio y su moneda originales (`price`, `finalPrice`, `currency`). El backend agrega, al lado, el precio convertido a la moneda del usuario (`displayPrice`, `displayFinalPrice`, `displayCurrency`). La conversión es **informativa**: el cobro siempre se hace en la moneda original del producto.

---

## 1. Cómo se decide la moneda en que se muestran los precios

En cada request, el backend resuelve la "moneda de visualización" en este orden:

1. **Header `X-Display-Currency`**, si trae un código soportado (por ejemplo `USD`). Se aceptan minúsculas y espacios alrededor.
2. **`displayCurrency` del usuario** (si hay sesión y la tiene guardada).
3. **`currency` del usuario** (si hay sesión y la tiene guardada).
4. **`CRC`** por defecto.

Si el header trae algo inválido o no soportado (`XYZ`, `JPY`, vacío), **no hay error 400**: se ignora y se sigue con el paso 2.

**Monedas soportadas (16):** `AOA`, `ARS`, `BRL`, `CHF`, `CLP`, `COP`, `CRC`, `EUR`, `GTQ`, `HNL`, `KRW`, `MXN`, `MZN`, `NIO`, `PEN`, `USD`.

### Qué debe mandar el front

- **Con sesión:** no hace falta mandar el header. Se usa la preferencia guardada del usuario. Mándalo solo si quieres forzar otra moneda temporalmente.
- **Sin sesión (visitantes):** manda siempre `X-Display-Currency` con la moneda detectada del navegador (la misma lógica que ya usan en el onboarding), guardada por ejemplo en `localStorage`. Si no la mandas, el visitante ve CRC.

```ts
// Ejemplo con fetch
fetch(`${API}/products?sort=price_asc`, {
  credentials: 'include',
  headers: { 'X-Display-Currency': visitorCurrency }, // p. ej. 'USD'
});
```

CORS ya permite este header; no hay que configurar nada más.

---

## 2. Campos nuevos en cada producto

Se **agregan** a los campos que ya existían; ninguno cambia de significado.

| Campo | Tipo | Significado |
|---|---|---|
| `displayPrice` | `number \| null` | `price` convertido a `displayCurrency`. `null` si no hay tipo de cambio. |
| `displayFinalPrice` | `number \| null` | `finalPrice` (con descuento) convertido. `null` si no hay tipo de cambio. |
| `displayCurrency` | `string` | Moneda de visualización resuelta para este request. |
| `isConverted` | `boolean` | `true` si se convirtió. `false` si la moneda del producto ya es la de visualización, o si no hubo tasa. |

Los campos originales `price`, `finalPrice`, `discountPercent` y `currency` vienen **intactos**.

**Redondeo:** a los decimales oficiales (ISO 4217) de la moneda destino. Son 0 decimales para `CLP` y `KRW`, y 2 para las demás.

**Ejemplo:** un producto de 30 USD visto por un usuario con moneda CRC.

```json
{
  "id": 22,
  "title": "Funko Pop Goku SSJ",
  "price": 30,
  "discountPercent": 10,
  "finalPrice": 27,
  "currency": "USD",
  "displayPrice": 15174,
  "displayFinalPrice": 13656.6,
  "displayCurrency": "CRC",
  "isConverted": true,
  "isSaved": false
}
```

**Ejemplo:** el mismo usuario viendo un producto que ya está en CRC.

```json
{
  "price": 25000,
  "finalPrice": 22500,
  "currency": "CRC",
  "displayPrice": 25000,
  "displayFinalPrice": 22500,
  "displayCurrency": "CRC",
  "isConverted": false
}
```

### Endpoints que traen los campos `display*`

| Endpoint | Dónde están los campos |
|---|---|
| `GET /products` | `data[]` |
| `GET /products/:id` | en la raíz del detalle |
| `GET /products/shop` | `sections[].products[]` |
| `GET /products/recommended` | en cada elemento del arreglo |
| `GET /products/:id/related` | en cada elemento del arreglo |
| `GET /search` (productos) | `products.data[]` (resumen) o `data[]` (con `type=products`) |
| `GET /favorites/me` | `data[].product` (cuando `type` es `product`) |
| `GET /posts/me` y `GET /users/:id/posts` | `data[].product` (cuando `type` es `product`) |
| `GET /users/:id/products` | `data[]` |
| `GET /conversations/:id/messages` | `conversation.product` |

Todos aceptan el header `X-Display-Currency`; también aparece documentado en Swagger.

**No convierten** (muestran solo la moneda original):

- `GET /products/me`: el vendedor ve sus productos en su propia moneda.
- Las respuestas de `POST /products`, `PATCH /products/:id` y `POST /products/:id/publish`. Devuelven el detalle sin campos `display*`.

### Cómo pintarlo

```ts
const fmt = (amount: number, currency: string) =>
  new Intl.NumberFormat(user.locale ?? navigator.language, {
    style: 'currency',
    currency,
  }).format(amount);

function priceLabel(p: Product) {
  if (p.displayFinalPrice === null) {
    return fmt(p.finalPrice, p.currency); // sin tipo de cambio: precio original
  }
  const shown = fmt(p.displayFinalPrice, p.displayCurrency);
  return p.isConverted ? `≈ ${shown}` : shown;
}
```

Recomendación: cuando `isConverted` es `true`, muestra el precio original como texto secundario (por ejemplo "≈ ₡13 656,60 · US$27,00").

---

## 3. Cambiar la moneda en ajustes

### Qué ya existía

- **`PATCH /users/me`** ya aceptaba `currency` y `locale`.
- **`POST /users/me/tags`** (onboarding) ya aceptaba `locale` y `currency` detectados del navegador.

### Qué es nuevo

- **Campo `displayCurrency`:** es la moneda en la que el usuario quiere **ver** los precios. Se acepta en ambos endpoints y se valida contra la lista de monedas soportadas.
- **`locale` validado como BCP 47:** por ejemplo `es-CR`, `es-419` o `en-US`. Un valor inválido como `es_CR` devuelve 400. Los valores ya guardados no se tocan.
- **`GET /users/me`:** ahora devuelve `displayCurrency`. Vale `null` si el usuario nunca la eligió; en ese caso se usa `currency`.

### `currency` y `displayCurrency` no son lo mismo

| Campo | Para qué sirve |
|---|---|
| `currency` | Moneda de **venta y de comisión** del vendedor. Es la moneda de sus productos **nuevos** y de sus tramos de comisión. |
| `displayCurrency` | Moneda en la que el usuario **ve** los precios. Solo afecta la visualización. |

El selector "Moneda" de los ajustes de visualización debe cambiar **`displayCurrency`**, no `currency`. Cambiar `currency` cambia la moneda en la que un vendedor publica sus productos.

```http
PATCH /users/me
Content-Type: multipart/form-data

displayCurrency=USD
```

Igual que el resto de los campos de `PATCH /users/me`. Respuesta, recortada:

```json
{
  "id": "6f1c2a9e-…",
  "username": "karina",
  "locale": "es-CR",
  "currency": "CRC",
  "displayCurrency": "USD"
}
```

**Errores (400):**

- `displayCurrency` no soportada: "displayCurrency no está soportada por Mynted".
- `locale` inválido: "locale debe ser una etiqueta de idioma BCP 47 (p. ej. es-CR, en-US)".

**Onboarding:** en `POST /users/me/tags` se puede mandar `displayCurrency` junto con `locale` y `currency`. Si solo mandan `currency`, los precios se muestran en esa moneda hasta que el usuario elija otra.

---

## 4. Filtros y orden por precio

Aplican a `GET /products` y a `GET /products/shop`.

| Parámetro | Valores | Comportamiento |
|---|---|---|
| `priceMin`, `priceMax` | número ≥ 0, hasta 2 decimales | Se interpretan **en la moneda de visualización** y comparan el **precio final** (con descuento). Los límites se incluyen. |
| `sort` | `newest` (por defecto), `price_asc`, `price_desc` | El orden por precio usa el precio final normalizado a USD. Si hay empate, primero el id más alto. |

**Cómo funciona:**

- **Rango:** cada producto se convierte a USD y luego a la moneda de visualización, con las mismas tasas y el mismo redondeo de `displayFinalPrice`. Así, un producto que se ve en ₡15 000,00 entra con `priceMax=15000`.
- **Monedas mezcladas:** ya no se comparan números de monedas distintas. Con display CRC y `priceMax=15000`, un producto de 30 USD (≈ ₡15 000) entra y uno de 35 USD no.
- **Productos sin tipo de cambio:** quedan **fuera** del rango y van **al final** en `price_asc` y en `price_desc`.
- **Moneda de visualización sin tasa:** el rango solo puede comparar los productos publicados en esa misma moneda.
- **El parámetro `currency` de `GET /products` sigue siendo un filtro** ("solo productos publicados en esta moneda"). No cambia la moneda en que se muestran los precios.
- **En `/products/shop`:** `sort` ordena los productos **dentro** de cada sección. El orden de las secciones (intereses y luego populares) no cambia.

```http
GET /products?priceMin=10000&priceMax=15000&sort=price_asc
X-Display-Currency: CRC
```

**Cambio respecto a antes:** `priceMin` y `priceMax` antes eran enteros y se comparaban "en crudo" contra el precio de cada producto en su moneda. Ahora aceptan decimales y están en la moneda de visualización.

---

## 5. Visitantes sin sesión

- Los endpoints públicos (`/products`, `/products/:id`, `/products/shop`, `/products/recommended`, `/products/:id/related` y `/search`) funcionan igual que con sesión.
- Manden `X-Display-Currency` con la moneda detectada del navegador. Sin el header, se muestra todo en **CRC**.
- Cuando el visitante cree su cuenta, manden esa misma moneda como `currency` y/o `displayCurrency` en el onboarding.

---

## 6. Si falla el tipo de cambio

Las tasas salen del mismo servicio que usa pagos:

- **USD↔CRC:** tipo de cambio de **venta del BCCR**, igual que `GET /payments/quote`.
- **Otras monedas:** Frankfurter. Se convierte siempre pasando por USD: origen → USD → destino.

Las tasas se cachean (memoria y base de datos). Si el proveedor no responde, se usa la **última tasa guardada**.

Solo si **no existe ninguna tasa guardada** para esa moneda:

- El producto sale con `displayPrice: null`, `displayFinalPrice: null` e `isConverted: false`. `displayCurrency` sigue indicando la moneda pedida.
- **La respuesta no falla:** el resto de los productos y campos llegan normal.
- El front debe mostrar el precio original (`finalPrice` + `currency`).
- Esa moneda no se vuelve a consultar durante 1 minuto.

---

## 7. El precio mostrado es aproximado; el cobro es en la moneda original

- `displayPrice` y `displayFinalPrice` son **referenciales**: el tipo de cambio cambia durante el día y por proveedor.
- El **cobro** siempre se hace en `currency` del producto, por el monto `finalPrice`.
- Para mostrar **cuánto va a pagar** el usuario antes del checkout, usen **`GET /payments/quote/:productId`**. Es la fuente oficial del monto (`amount` + `currency`) y trae `convertedAmount` como referencia.
- Recomendación de texto: "Precio aproximado en tu moneda. Se cobra en {currency}."

---

## 8. Pendiente de implementar

- **`GET /search`:** no tiene `sort` ni `priceMin` y `priceMax`. Los productos traen los campos `display*`, pero el orden sigue siendo por fecha.
- **Bandeja del chat (`GET /conversations`):** el resumen del producto de cada conversación no trae campos `display*`. Sí los trae el historial (`GET /conversations/:id/messages`).
- **Endpoints del vendedor:** `GET /products/me` y las respuestas de crear, editar y publicar no convierten (es intencional).
- **Pagos** (`/payments/me/purchases`, `/payments/me/sales`, recibos):
  - Siguen en la moneda de la transacción.
  - `GET /payments/quote/:productId` convierte `convertedAmount` a `currency` del usuario, **no** a `displayCurrency`, y usa la tasa directa del par (no pasa por USD).
  - Para monedas distintas de USD y CRC, ese monto puede diferir un poco del `displayFinalPrice`. Está pendiente coordinarlo con el equipo de pagos.
- **Formato por `locale`:** el backend guarda `locale` pero no lo usa. El formato de números lo hace el front con `Intl.NumberFormat`.
