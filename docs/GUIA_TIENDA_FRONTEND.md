# Guía de la tienda del vendedor para el frontend

Endpoints para la pantalla de tienda de un vendedor, el tiempo de respuesta y la búsqueda de tiendas.

**Todos los endpoints de tienda son públicos:** funcionan sin sesión y, si hay sesión, se aprovecha (por ejemplo, para `isSaved`).

---

## 1. Quién cuenta como vendedor

Solo un vendedor **aprobado** (`isVerified: true`) con **cuenta activa** tiene tienda.

El registro de vendedor se crea cuando el usuario **solicita** serlo, así que un solicitante pendiente o rechazado ya tiene ese registro. Aun así, se trata como un usuario sin tienda:

| Dónde | Vendedor aprobado | Pendiente, rechazado o cuenta desactivada |
|---|---|---|
| `GET /sellers/:sellerId` (y `/products`, `/tags`) | 200 | **404** (igual que si no existiera) |
| Objeto `seller` del perfil público (`GET /users/:id`, `GET /users/by-username/:username`, búsqueda de usuarios) | presente | **no viene** |
| `GET /users/me` | trae `seller` | **no trae `seller`** |
| `GET /profiles/:perfilId/reputation` | datos reales | `isSeller: false`, `ratingAverage: null`, conteos en 0 |
| `GET /search?type=stores` | aparece | **no aparece** |

Un pendiente tampoco puede publicar productos: crear, publicar y borrar exigen el rol `seller`, que se asigna al aprobar.

**Cómo llegar a la tienda:** el objeto `seller` del perfil público y de `/users/me` trae `sellerId`. Con ese valor abre `/sellers/:sellerId`.

---

## 2. `GET /sellers/:sellerId` — perfil de la tienda

`sellerId` es el id numérico de la tienda, **no** el `User.id`.

```json
{
  "sellerId": 4,
  "userId": "6f1c2a9e-1b2c-4d3e-8f90-123456789abc",
  "displayName": "Funko Corner CR",
  "description": "Funkos originales y ediciones limitadas",
  "location": "San José",
  "photoUrl": "https://res.cloudinary.com/…/karina.png",
  "bannerUrl": null,
  "isVerified": true,
  "ratingAverage": 4.7,
  "reviewsCount": 12,
  "completedSalesCount": 15,
  "activeProductsCount": 8,
  "sellerSince": "2026-09-01T12:00:00.000Z",
  "responseTime": { "medianMinutes": 20, "sampleSize": 9 }
}
```

| Campo | Notas |
|---|---|
| `userId` | `User.id` del vendedor: para su perfil (`/users/:id`) o para abrir un chat. |
| `location` | La de la tienda; si está vacía, la del perfil del usuario; si tampoco hay, `null`. |
| `photoUrl` | La foto de perfil del usuario. |
| `bannerUrl` | **Siempre `null` por ahora** (ver Pendiente). |
| `ratingAverage` / `reviewsCount` | Promedio (1 decimal) y total de las reseñas de **todos** sus productos. `null` / `0` si no tiene reseñas. |
| `completedSalesCount` | Ventas completadas. |
| `activeProductsCount` | Productos **activos y visibles**, sin contar los de comunidades privadas. |
| `sellerSince` | Fecha de aprobación como vendedor. Para vendedores aprobados antes de esta versión, es la fecha del badge `verified_seller`. Puede ser `null`. |
| `responseTime` | Ver la sección 5. |

Nunca trae datos de pago ni el correo.

**Errores:**
- **404:** la tienda no existe, el vendedor no está aprobado o su cuenta está desactivada.
- **400:** `sellerId` no es un número.

---

## 3. `GET /sellers/:sellerId/products` — productos de la tienda

Misma forma de respuesta que `GET /products`: `{ data: ProductListItem[], pagination }`. Cada producto trae `price`, `finalPrice` y `currency` originales, y también `displayPrice`, `displayFinalPrice`, `displayCurrency` e `isConverted` (ver [GUIA_MONEDA_FRONTEND.md](GUIA_MONEDA_FRONTEND.md)).

| Query | Valores |
|---|---|
| `status` | `active` (por defecto) o `sold`. `draft` e `inactive` → **400**. |
| `tag` | id de tag (por ejemplo, el elegido en `/tags`). |
| `type` | `sale` o `exchange`. |
| `condition` | `new`, `like_new`, `good_condition` o `used_with_details`. |
| `sort` | `recent` (por defecto; `newest` es sinónimo), `price_asc` o `price_desc`. |
| `priceMin`, `priceMax` | Opcionales, en la moneda de visualización (igual que en `/products`). |
| `page`, `limit` | Por defecto 1 y 10; `limit` máximo 100. |

- **Comunidades privadas:** sus productos **no** aparecen, con el mismo criterio que `GET /users/:id/products`.
- **Moneda:** manda el header **`X-Display-Currency`** para elegir en qué moneda se muestran los precios. Sin header se usa la del usuario (si hay sesión) o CRC.

```http
GET /sellers/4/products?status=active&sort=price_asc&page=1&limit=12
X-Display-Currency: USD
```

```json
{
  "data": [
    {
      "id": 22, "title": "Funko Pop Goku SSJ",
      "price": 25000, "discountPercent": 10, "finalPrice": 22500, "currency": "CRC",
      "displayPrice": 49.43, "displayFinalPrice": 44.48, "displayCurrency": "USD", "isConverted": true,
      "status": "active", "type": "sale", "condition": "new",
      "productTags": [{ "tag": { "tagId": 3, "name": "Funko Pop" } }],
      "isSaved": false
    }
  ],
  "pagination": { "page": 1, "limit": 12, "total": 8, "totalPages": 1 }
}
```

---

## 4. `GET /sellers/:sellerId/tags` — filtros de la tienda

Tags de los productos **activos** de la tienda (sin comunidades privadas), con cuántos productos tiene cada uno. Ordenados de mayor a menor cantidad; si hay empate, por nombre.

```json
[
  { "tagId": 3, "name": "Funko Pop", "count": 5 },
  { "tagId": 7, "name": "Anime", "count": 2 }
]
```

Úsalos como chips. Al tocar uno, llama `/products?tag=<tagId>`. 404 si la tienda no es pública.

---

## 5. Tiempo de respuesta (`responseTime`)

```json
"responseTime": { "medianMinutes": 20, "sampleSize": 9 }   // o null
```

Aparece en:
- `GET /sellers/:sellerId`.
- El objeto `seller` del perfil público (`GET /users/:id` y `GET /users/by-username/:username`).
- El objeto `seller` de `GET /users/me`, que solo viene si el usuario es vendedor aprobado. El resto de campos de `/users/me` no cambia.

**Cómo se calcula:**
- Por cada conversación donde el usuario es el vendedor, se mide el tiempo entre el **primer mensaje del comprador** y el **primer mensaje del vendedor después de ese**.
- Se usan las conversaciones cuyo primer mensaje del comprador es de los **últimos 90 días**.
- `medianMinutes` es la **mediana** en minutos, redondeada. `sampleSize` es cuántas conversaciones respondidas entraron en el cálculo.
- **`null` si hay menos de 3 conversaciones respondidas**. Muestra algo como "Aún sin datos" o no muestres el dato.

**Casos particulares:**
- Si el vendedor escribió antes que el comprador, esos mensajes no cuentan.
- Las conversaciones sin respuesta no entran en la mediana.
- Las conversaciones de productos borrados sí cuentan.

**Cómo mostrarlo:** por ejemplo, "Responde en ~20 min". Con `medianMinutes >= 60`, "Responde en ~1 h". Con `>= 1440`, "Responde en ~1 día".

El valor se cachea 10 minutos en el servidor, así que un mensaje nuevo puede tardar hasta 10 minutos en reflejarse.

---

## 6. Búsqueda de tiendas: `GET /search?type=stores`

Busca en el **nombre** y la **descripción** de la tienda sin distinguir mayúsculas ni tildes: `nino` encuentra "Niño" y `jugueteria` encuentra "Juguetería". Solo incluye vendedores aprobados con cuenta activa, ordenados por nombre.

```http
GET /search?q=funko&type=stores&page=1&limit=20
```

```json
{
  "type": "stores",
  "data": [
    {
      "sellerId": 4,
      "userId": "6f1c2a9e-1b2c-4d3e-8f90-123456789abc",
      "displayName": "Funko Corner CR",
      "photoUrl": "https://res.cloudinary.com/…/karina.png",
      "location": "San José",
      "isVerified": true,
      "ratingAverage": 4.7,
      "reviewsCount": 12,
      "activeProductsCount": 8
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

**Sin `type`**, el resumen de `/search` incluye `"stores": { "data": [...], "total": N }`, con los primeros 5.

---

## 7. Pendiente

- **Banner de la tienda:** `bannerUrl` es siempre `null`. Falta guardarlo y un endpoint para subirlo.
- **Tildes en los otros tipos de búsqueda:** solo `type=stores` ignora tildes. `users`, `posts`, `products` y `communities` siguen distinguiéndolas.
- **Orden y rango de precio en `/search`** (de [GUIA_MONEDA_FRONTEND.md](GUIA_MONEDA_FRONTEND.md)).
- **Campos extra del perfil** que todavía no existen en el backend:
  - **Última conexión:** solo se sabe si alguien está en línea en el chat en este momento; no se guarda la última vez.
  - **Redes sociales o enlaces externos.**
  - **Banner del perfil de usuario.**
- **Países de envío:** ya existen por producto (`shipsTo`, y el filtro `shipTo` en `/products`), pero **no** se resumen a nivel de tienda.
