# Mynted API – Guía para el frontend

Resumen de los endpoints nuevos o cambiados del backend y cómo consumirlos.
Swagger completo en `http://localhost:3000/api`.

## Transferencia de propiedad de una comunidad

`POST /communities/:communityId/transfer` requiere sesión y el usuario debe ser
el OWNER activo de esa comunidad. Un SUPERADMIN sin perfil OWNER comunitario
también recibe `403`.

Body:

```json
{ "profileId": 123 }
```

`profileId` debe pertenecer a un miembro activo de la comunidad. Puede ser
`MEMBER` o `MODERATOR`. Después de transferir, el OWNER anterior queda como
`MODERATOR` y el perfil destino queda como `OWNER`; no se recrean perfiles ni
se modifican publicaciones, respuestas o fechas de membresía.

Respuesta exitosa:

```json
{ "message": "Propiedad de la comunidad transferida correctamente" }
```

Errores principales: `400` por `profileId` inválido, `403` si el actor no es
OWNER, `404` si la comunidad o el perfil no existen/están removidos, y `409`
si el destino está inactivo, baneado o es el mismo OWNER.

## Notificaciones de moderadores

Estas notificaciones se generan únicamente mediante los endpoints
administrativos explícitos del OWNER:

- `POST /communities/:communityId/moderators/:profileId` genera
  `community_moderator_added`.
- `DELETE /communities/:communityId/moderators/:profileId` genera
  `community_moderator_removed`.

Solo se notifica al usuario afectado. La data tiene este formato:

```json
{
  "communityId": 1,
  "communityName": "Nombre de la comunidad",
  "communitySlug": "slug"
}
```

La transferencia de ownership, kick, ban, unban y leave no generan estas
notificaciones. Un fallo al guardar la notificación no revierte el cambio de
rol.

## Dirección de envío en checkout

`POST /payments/checkout` requiere `shippingAddress` para compras de productos
de venta. La dirección se guarda como snapshot histórico de la transacción.

```json
{
  "fullName": "María López",
  "phone": "88888888",
  "country": "CR",
  "province": "San José",
  "city": "San José",
  "line1": "Avenida Central",
  "line2": null,
  "postalCode": null,
  "notes": null
}
```

`fullName`, `phone`, `country`, `province`, `city` y `line1` son obligatorios.
`line2`, `postalCode` y `notes` son opcionales; los valores vacíos se guardan
como `null`. `country` usa ISO 3166-1 alpha-2 y se normaliza a mayúsculas.

La misma `Idempotency-Key` con la misma dirección reutiliza la transacción
original. Si se envía otra dirección con esa clave, responde `409` y no cambia
el snapshot existente.

`GET /payments/:id` incluye `shippingAddress` para el comprador o vendedor
autorizado. `GET /payments/me/purchases` y `GET /payments/me/sales` no incluyen
la dirección completa en sus listados. Las notificaciones de compra/venta
tampoco contienen datos de envío.

## 0. Convenciones generales

| Tema                                           | Detalle                                                                                                                                                                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Base URL                                       | `http://localhost:3000`                                                                                                                                                                                                                                |
| Sesión                                         | Cookies **httpOnly** `access_token` y `refresh_token` (las setea `POST /auth/login`, `POST /users`, login social). Usa `fetch(..., { credentials: 'include' })` / `axios withCredentials: true`. CORS acepta `http://localhost:5173` con credenciales. |
| 401                                            | Sin sesión o token vencido → `POST /auth/refresh` y reintenta; si falla, manda a login.                                                                                                                                                                |
| Errores                                        | `{ "statusCode": 400, "message": "texto" \| ["texto1","texto2"], "error": "Bad Request" }`. `message` puede ser **arreglo** (validaciones).                                                                                                            |
| Paginación plana                               | `{ "data": [...], "pagination": { "page", "limit", "total", "totalPages" } }`                                                                                                                                                                          |
| Paginación por secciones (shop, mis productos) | Secciones 4 y 5.                                                                                                                                                                                                                                       |
| Multipart                                      | Crear/editar producto y `PATCH /users/me` son `multipart/form-data`. Arreglos (`tagIds`, `shipsTo`, `relatedProductIds`) como JSON string: `[1,3,5]`, `["CR","MX"]`. Booleanos como `"true"`/`"false"`.                                                |
| Enums (en inglés)                              | `role`: `user`/`seller`/`superadmin` · producto `type`: `sale`/`exchange` · `condition`: `new`/`like_new`/`good_condition`/`used_with_details` · `status`: `draft`/`active`/`inactive`/`sold`                                                          |
| Endpoints "sin sesión"                         | Funcionan con o sin cookie. Con cookie traen datos personalizados (`isSaved`, `myVote`, intereses, comunidades).                                                                                                                                       |

---

## 1. Feeds de posts: Home, Explore y orden por votos

### 1.1 Cómo se ordenan los posts (todos los feeds)

Todos los listados de posts tienen en cuenta **upvotes y downvotes** y se recalculan **en cada petición** (con los votos de ese momento):

| `sort`                  | Orden                                                                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hot` (**por defecto**) | Votos netos (`upVotes - downVotes`, en escala logarítmica) combinados con la frescura: un post pierde la mitad de su peso cada X días. Un post muy rechazado baja aunque sea nuevo. |
| `new`                   | Solo los más recientes primero (no mira votos).                                                                                                                                     |
| `top`                   | Más votos netos primero.                                                                                                                                                            |

`sort` existe en `GET /posts`, `GET /communities/:id/posts` y `GET /home/posts`. En `/forums/me` y `/users/:id/forums` el parámetro se llama `sortBy` y acepta `hot` (por defecto), `date`, `upvotes`, `downvotes`, `saves`.

> **Cambio de comportamiento:** antes esos feeds venían solo por fecha. Si quieres el orden cronológico de antes, manda `sort=new`.

Las listas personales (`/posts/me`, `/favorites/me`) siguen cronológicas a propósito (fecha de publicación / de guardado).

### 1.2 `GET /home/posts` (funciona sin sesión)

Query: `page` (1), `limit` (10, máx. 50), `sort` (`hot`|`new`|`top`).

- **Con sesión:** posts de las comunidades **a las que perteneces** (incluidas las privadas donde eres miembro). `meta.source = "joined"`.
- **Sin sesión**, o si todavía no perteneces a ninguna comunidad (o las tuyas no tienen posts): posts de comunidades **públicas**. `meta.source = "public"`.
- `hot` en Home pesa mucho lo **reciente** (vida media 1,5 días) y usa los votos como empuje.

```json
{
  "data": [ /* PostCard */ ],
  "pagination": { "page": 1, "limit": 10, "total": 36, "totalPages": 4 },
  "meta": { "source": "joined" | "public" }
}
```

Si `meta.source = "public"` y no hay sesión, puedes mostrar un banner "Únete a comunidades para personalizar tu Home".

### 1.3 `GET /explore/forums/posts` (funciona sin sesión)

También disponible como `GET /users/me/recommended-posts` (requiere sesión; misma lógica). Query: `page` (1), `limit` (10, máx. 50).

Es el "for you" de descubrimiento. Puntaje de cada post:

- **Afinidad** con tus intereses (tags del post que coinciden con los tuyos).
- **Popularidad** (upvotes - downvotes).
- **Frescura** (vida media de 7 días).
- **Bonus por comunidades que aún no conoces** (para descubrir).
- Una **pequeña variación estable por hora** (el feed cambia cada hora, pero no se baraja mientras paginas).

Sin sesión (o sin intereses) queda **popularidad + frescura**. Solo comunidades **públicas**. Si estás autenticada, los posts de comunidades donde no estás suben un poco para que descubras más.

```json
{
  "data": [ { /* PostCard */, "matchedTagCount": 2 } ],
  "pagination": { "page": 1, "limit": 10, "total": 81, "totalPages": 9 },
  "meta": { "personalized": true }
}
```

`meta.personalized = false` cuando no hay sesión o el usuario no tiene intereses (puedes invitarle a elegirlos).

### 1.4 Otros feeds

| Endpoint                                           | Notas                                                                                   |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET /posts?search=&tagIds=1,3&sort=&page=&limit=` | Feed global de comunidades públicas. **Ya no requiere sesión.** `limit` por defecto 20. |
| `GET /communities/:id/posts?sort=&page=&limit=`    | Posts de una comunidad (requiere sesión; si es privada, ser miembro).                   |

### 1.5 Paginación y orden dinámico

Como el orden depende de los votos del momento, entre una página y la siguiente un post puede cambiar de posición. Al **añadir páginas al feed, descarta ids que ya tienes** (dedupe por `id`). Para refrescar el orden completo, vuelve a pedir desde `page=1`.

### 1.6 Tiempo real (SSE)

`GET /posts/live` es un stream **Server-Sent Events** (no necesita sesión). Cada vez que cambian los **votos, guardados o respuestas** de cualquier post, emite:

```
event: post-metrics
data: {"postId":12,"upVotes":5,"downVotes":1,"timesSaved":2,"replyCount":3}
```

y un `ping` cada 25 s para mantener la conexión.

```js
const es = new EventSource('http://localhost:3000/posts/live', {
  withCredentials: true,
});
es.addEventListener('post-metrics', (e) => {
  const m = JSON.parse(e.data);
  // actualiza contadores del post m.postId si está en pantalla
});
```

Recomendaciones:

- **Actualiza solo los contadores** de los posts visibles. **No reordenes la lista en vivo** (los posts saltarían mientras lee); el orden nuevo se aplica al refrescar o pedir otra vez el feed.
- Abre **una sola conexión** por pestaña (por ejemplo en el layout) y filtra por `postId`.
- `myVote` / `isSaved` son personales y **no** vienen en el evento: actualízalos con la respuesta de tu propio `PUT .../vote` o `.../favorite`.
- `EventSource` reconecta solo si se cae.

---

## 2. Perfil público de usuarios

Todos requieren sesión.

### `PublicUser`

```json
{
  "id": "uuid",
  "username": "karina_funko",
  "photoUrl": "https://...",
  "bio": "...",
  "location": "San José",
  "role": "seller",
  "createdAt": "2026-10-01T...",
  "seller": {
    // solo si es vendedor APROBADO
    "sellerId": 4, // para abrir la tienda: GET /sellers/:sellerId
    "displayName": "Funko Corner CR",
    "isVerified": true,
    "ratingAverage": 4.7, // null si no tiene reseñas
    "reviewsCount": 12,
    "responseTime": { "medianMinutes": 20, "sampleSize": 9 } // null si hay poca muestra
  }
}
```

Nunca trae correo, locale, moneda, preferencias ni datos de solicitud de vendedor. Un solicitante pendiente o rechazado no trae `seller`. Tienda y tiempo de respuesta: ver [GUIA_TIENDA_FRONTEND.md](GUIA_TIENDA_FRONTEND.md).

| Endpoint                                            | Para qué                                                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `GET /users/:id`                                    | Perfil público. Cuenta desactivada → 404. (Un superadmin recibe el usuario completo.)                                         |
| `GET /users/by-username/:username`                  | Igual, por username.                                                                                                          |
| `GET /users/search?q=&page=&limit=`                 | Búsqueda por username (contiene, sin mayúsculas). `q` obligatorio. Solo cuentas activas. → `{data: PublicUser[], pagination}` |
| `GET /users/:id/posts?order=desc&page=&limit=`      | Tab "Todo" del perfil: posts **y** productos mezclados por fecha. Solo contenido público.                                     |
| `GET /users/:id/forums?sortBy=&order=&page=&limit=` | Solo posts de foro. `sortBy`: `hot` (def.) `date` `upvotes` `downvotes` `saves`; `order`: `desc` (def.) `asc`.                |
| `GET /users/:id/products?order=&page=&limit=`       | Solo productos **activos** (lista plana de tarjetas de producto).                                                             |
| `GET /users/:id/tags`                               | Intereses del usuario → `[{tagId, name, ...}]`                                                                                |
| `GET /users/:id/badges`                             | Badges (sección 10).                                                                                                          |

`order`: `desc` = más reciente primero · `limit` por defecto 20 (máx. 50).

Respuesta de `/users/:id/posts` (y de `/posts/me`, `/favorites/me`):

```json
{
  "data": [
    { "type": "post", "date": "...", "post": {/* PostCard */} },
    { "type": "product", "date": "...", "product": {/* ProductCard */} }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 7, "totalPages": 1 }
}
```

Renderiza según `type`.

### Tarjetas

**PostCard**

```json
{
  "id": 3, "title": "...", "body": "...", "postedAt": "...",
  "author": { "communityProfileId": 5, "displayName": "...", "role": "member", "photoUrl": "..." },
  "tags": [{ "tagId": 1, "name": "..." }],
  "images": [{ "id": 1, "url": "...", "order": 1 }],
  "upVotes": 3, "downVotes": 0, "timesSaved": 1,
  "myVote": "UP" | "DOWN" | null,
  "isSaved": false, "replyCount": 2,
  "community": { "id": 1, "name": "...", "slug": "...", "imageUrl": "..." }
}
```

**ProductCard** (perfil, `/posts/me`, `/favorites/me`)

```json
{
  "id": 22,
  "title": "...",
  "price": 25.99,
  "discountPercent": 15,
  "finalPrice": 22.09,
  "currency": "USD",
  "imageUrl": "...",
  "status": "active",
  "type": "sale",
  "condition": "new",
  "tags": [{ "tagId": 1, "name": "..." }],
  "community": { "id": 1, "name": "..." }, // null si no tiene comunidad
  "seller": {
    "sellerId": 4,
    "userId": "6f1c2a9e-…",
    "displayName": "...",
    "photoUrl": "...",
    "isVerified": true
  },
  "isSaved": false,
  "notifyPrice": false, // avisos de quien mira (false si no lo guardó)
  "notifyAvailability": false
}
```

`seller.userId` es el `User.id` del vendedor: úsalo para enlazar a su perfil (`/users/:id`) o abrir un chat.

---

## 3. Mi cuenta y preferencias

### Cambio de correo

1. `POST /auth/request-email-change` (con sesión) `{ "newEmail": "nuevo@test.com" }` → 200. Envía un enlace al **correo nuevo**: `${FRONTEND_URL}/confirm-email-change?token=...`.
2. La página `/confirm-email-change` lee `token` y llama `POST /auth/confirm-email-change` `{ "token": "..." }` (no requiere sesión) → 200.

Errores: 400 token inválido/vencido/ya usado · 409 el correo ya está en uso (sin distinguir mayúsculas).

### `GET /users/me`

Usuario completo: incluye `locale`, `currency`, `displayCurrency`, `country`, `emailNotifications`, `pushNotifications`, `confirmUnfavorite`, `role`, `sellerRequestStatus`. Si es vendedor aprobado trae además `seller` (misma forma que en `PublicUser`, con `sellerId` y `responseTime`).

### `PATCH /users/me` (multipart)

Campos opcionales (manda al menos uno): `username`, `bio`, `location`, `locale`, `currency` (**ISO 4217**, ej. `CRC`, `USD`; se pasa a mayúsculas; moneda de venta/comisión), `displayCurrency` (moneda en que se **ven** los precios; ver [GUIA_MONEDA_FRONTEND.md](GUIA_MONEDA_FRONTEND.md)), `country` (**ISO 3166-1 alfa-2**, ej. `CR`), `emailNotifications`, `pushNotifications`, `confirmUnfavorite` (booleanos), `photo` (archivo, 5 MB).

- **`confirmUnfavorite`** (por defecto `true`): es una **preferencia que solo guarda el backend**; no cambia el comportamiento de la API. Si es `true`, el front debe mostrar un diálogo "¿Quitar de favoritos?" antes de llamar al `DELETE .../favorite`; si es `false`, lo quita directo. Sirve para un "No volver a preguntar" que se conserve entre dispositivos.
- **Importante:** para publicar productos el usuario **debe tener `currency`**; si no, recibe 400.

---

## 4. Productos: modelo

### Estados (`status`)

| Estado     | Significado                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------- |
| `draft`    | Borrador. Solo lo ve su dueño. No aparece en ningún listado, búsqueda, recomendación ni perfil. |
| `active`   | Publicado.                                                                                      |
| `inactive` | Pausado por el vendedor. Se puede reactivar.                                                    |
| `sold`     | Vendido. No puede volver a `active`.                                                            |

### Campos de precio

- `price`: precio original (nunca se modifica). `discountPercent`: 0–100 o `null`. `finalPrice`: precio con descuento (calculado). **Muestra `finalPrice` y tacha `price` si hay descuento.**
- Los filtros `priceMin/priceMax` comparan contra `finalPrice`, en la moneda de visualización (ver [GUIA_MONEDA_FRONTEND.md](GUIA_MONEDA_FRONTEND.md)).

### Otros campos

`isVisible` (si es `false` no sale en listados públicos), `shipsTo` (`["CR","MX"]`), `publishedAt`, `currency`.

### 4.1 Crear / editar

| Endpoint                                  | Notas                                                                                                                                        |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /products`                          | Publica **sin comunidad**. Rol vendedor.                                                                                                     |
| `POST /communities/:communityId/products` | Publica **en una comunidad**. Rol vendedor **y** ser miembro de esa comunidad (si no → 403).                                                 |
| `PATCH /products/:id`                     | Edita (publicado o borrador). Solo el dueño.                                                                                                 |
| `POST /products/:id/publish`              | Publica un borrador (valida todo).                                                                                                           |
| `PATCH /products/:id/status` `{status}`   | `inactive`/`sold` para pausar/vender; `active` para **reactivar** un `inactive` o publicar un `draft`. Un `sold` no vuelve a `active` (400). |
| `DELETE /products/:id`                    | Borrado lógico (204). Desaparece de todo; se conservan favoritos y conversaciones.                                                           |

**Campos del multipart (crear):**

| Campo                                       | Tipo          | Notas                                                 |
| ------------------------------------------- | ------------- | ----------------------------------------------------- |
| `title`                                     | string        | **Siempre obligatorio.**                              |
| `description`, `price`, `type`, `condition` |               | Obligatorios **al publicar**; opcionales en borrador. |
| `tagIds`                                    | `[1,3,5]`     | Al publicar: **exactamente 3**. En borrador: hasta 3. |
| `image`                                     | archivo       | Portada. Obligatoria al publicar.                     |
| `images`                                    | archivos      | Galería (hasta 6, opcional).                          |
| `discountPercent`                           | número 0–100  | Opcional.                                             |
| `isVisible`                                 | boolean       | Opcional (por defecto `true`).                        |
| `shipsTo`                                   | `["CR","MX"]` | Opcional. Códigos ISO de país.                        |
| `relatedProductIds`                         | `[10,11]`     | Opcional, máx. 6, **tuyos y activos**.                |
| `saveAsDraft`                               | boolean       | `true` = guarda borrador (solo exige `title`).        |

`PATCH` acepta los mismos campos (todos opcionales) y además `communityId` (ver 4.2). `tagIds`, `shipsTo`, `relatedProductIds` y `images` **reemplazan** por completo lo anterior (`[]` borra). Un producto publicado debe quedar con exactamente 3 tags.

Errores al publicar: **400 con `message` como arreglo** listando lo que falta, p. ej.
`["description es obligatorio","Debe seleccionar exactamente 3 tags","Configura tu moneda (currency) en tu perfil antes de publicar productos"]`. Muéstralos todos.

**Flujo de borrador en el front**

1. Formulario → "Guardar borrador" → `POST` con `saveAsDraft=true`.
2. Lista "Borradores" → `GET /products/me?status=draft`.
3. "Publicar" → `POST /products/:id/publish` (si falta algo, 400 con la lista).

### 4.2 ¿Por qué hay dos `POST` y qué cambia entre ellos?

Son **la misma acción** (publicar un producto, mismos campos, mismo resultado). Lo único que cambia es **dónde queda publicado**:

|                  | `POST /products`                                                                  | `POST /communities/:communityId/products`                   |
| ---------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Comunidad        | **No lleva** (el producto queda "suelto": `community: null`, `communityId: null`) | La comunidad va **en la URL y es obligatoria** en esta ruta |
| Requisitos extra | Ser vendedor                                                                      | Ser vendedor **y miembro** de esa comunidad                 |
| Visibilidad      | Público siempre                                                                   | Público si la comunidad es pública y activa                 |

"Opcional" significa que **el producto puede o no pertenecer a una comunidad**; el front elige la ruta según si el vendedor escogió una comunidad en el formulario. No se manda `communityId` en el body al crear.

Un producto **sin comunidad** aparece en shop, `/products`, búsqueda, perfil del vendedor, favoritos y recomendados. En las tarjetas, `community` puede ser `null` → no pintes el chip de comunidad.

**Mover o quitar la comunidad:** `PATCH /products/:id` con `communityId=5` lo mueve a esa comunidad (hay que ser miembro; si no, 403; si no existe, 404). Con `communityId=null` (el texto `null` en el multipart) queda sin comunidad. Si no se manda, no cambia.

### 4.3 Lecturas (funcionan **sin sesión**)

**`GET /products`** – listado/filtros. Query: `communityId`, `tag`, `category`, `type`, `condition`, `currency` (ISO 4217, filtro por moneda del producto), `priceMin`, `priceMax` (decimales, sobre el precio final y **en la moneda de visualización**), `sort` (`newest`|`price_asc`|`price_desc`), `shipTo` (ISO país), `page` (1), `limit` (10, máx. 100). Solo `active` + `isVisible`. Cada producto trae además `displayPrice`, `displayFinalPrice`, `displayCurrency` e `isConverted` (ver [GUIA_MONEDA_FRONTEND.md](GUIA_MONEDA_FRONTEND.md)).
→ `{ data: ProductListItem[], pagination }`

**`ProductListItem`** (también en `/products/recommended`, `/products/:id/related`, `/search`):

```json
{
  "id": 27,
  "title": "...",
  "description": "...",
  "price": 30,
  "discountPercent": null,
  "finalPrice": 30,
  "currency": "USD",
  "imageUrl": "...",
  "status": "active",
  "type": "sale",
  "condition": "new",
  "shipsTo": ["CR"],
  "sellerId": 4,
  "communityId": 3,
  "isVisible": true,
  "publishedAt": "...",
  "createdAt": "...",
  "productTags": [
    { "tagId": 1, "tag": { "tagId": 1, "name": "Coleccionismo" } }
  ],
  "isSaved": false
}
```

(`communityId` puede ser `null`.)

**`GET /products/:id`** – detalle:

```json
{
  "id": 22,
  "title": "...",
  "description": "...",
  "price": 25.99,
  "discountPercent": 15,
  "finalPrice": 22.09,
  "currency": "USD",
  "status": "active",
  "type": "sale",
  "condition": "new",
  "shipsTo": [],
  "isVisible": true,
  "communityId": null,
  "productTags": [{ "tag": { "tagId": 1, "name": "..." } }],
  "images": [{ "url": "...", "order": 0 }],
  "isSaved": false,
  "ratingAverage": 4.5, // null si no hay reseñas
  "reviewsCount": 8,
  "canReview": false, // ¿puede quien mira reseñarlo ahora? (ver sección 15)
  "hasReviewed": false, // ya tiene reseña propia
  "reviewId": null, // id de su reseña (para "editar tu reseña")
  "canComment": false, // DEPRECADO: alias de canReview
  "seller": {
    "sellerId": 4,
    "userId": "6f1c2a9e-1b2c-4d3e-8f90-123456789abc",
    "displayName": "...",
    "isVerified": true,
    "photoUrl": "...",
    "ratingAverage": 4.7,
    "reviewsCount": 12
  }
}
```

Un `draft` solo lo ve su dueño (404 para los demás). Borrado → 404.

- **`seller.userId`** (uuid): el `User.id` del vendedor, para enlazar a su perfil o abrir un chat. Nunca se expone `paymentInfo`.
- **`canReview`, `hasReviewed` y `reviewId`** (a nivel de producto, **no** dentro de `seller`): ver la sección 15. `canComment` sigue existiendo como alias **deprecado** de `canReview`; migra a `canReview`.
- **Productos `exchange`:** todavía no se pueden reseñar (no existe el flujo de intercambio), así que `canReview` es siempre `false` y el POST responde 403.

**`GET /products/:id/related`** → arreglo de `ProductListItem` con `isSellerChoice: boolean`. Primero los que eligió el vendedor, luego automáticos por tags/comunidad (y por tus intereses si hay sesión). Máx. 6, sin duplicados.

**`GET /products/recommended?currentProductId=&recentProductIds=1,2,3&limit=4`** → arreglo de `ProductListItem`. Señales: intereses + últimos 10 productos vistos + tags/comunidad del producto actual. **Sin sesión** manda `recentProductIds` (máx. 10; guárdalos en cookie/localStorage). Sin señal → los más recientes.

**`POST /products/:id/view`** (con sesión, 204): llámalo al abrir el detalle. Alimenta las recomendaciones; las vistas del propio vendedor no cuentan.

---

## 5. Shop (scroll infinito por tags)

**`GET /products/shop`** (sin sesión). Una sección por tag que tenga productos.

Query: `page` (1) y `limit` (3, máx. 20) → **secciones** por página · `productsPage` (1) y `productsLimit` (4, máx. 20) → productos dentro de cada sección · `shipTo`.

```json
{
  "sections": [
    {
      "tag": { "tagId": 1, "name": "Coleccionismo" },
      "source": "interest" | "popular",
      "totalProducts": 9,
      "products": [ /* TagProductCard */ ],
      "pagination": { "page": 1, "limit": 4, "totalPages": 3 }
    }
  ],
  "pagination": { "page": 1, "limit": 3, "totalSections": 12, "totalPages": 4 }
}
```

- **Scroll infinito:** pide `page=1,2,3…` mientras `page < pagination.totalPages`.
- Con sesión: primero los tags de interés (`source: "interest"`), luego el resto por popularidad. Sin sesión: todo por popularidad.
- Un producto aparece **una sola vez** (en la primera sección cuyo tag tenga).
- "Show all": `GET /products?tag=<tagId>`.

`TagProductCard`: `id, title, price, discountPercent, finalPrice, currency, imageUrl, type, condition, isSaved, tags[], seller{sellerId, userId, displayName, photoUrl, isVerified}`.

---

## 6. Panel del vendedor

Requiere rol `seller`.

**`GET /products/me`** – mis productos (cualquier estado, **borradores incluidos**) agrupados por tag.
Query: `status` (`draft|active|inactive|sold`), `q` (busca por título), `type`, `condition`, `priceMin`, `priceMax`, `tagId` (solo la sección de ese tag, para "Show all"), `page`/`limit` (secciones, def. 3), `productsPage`/`productsLimit` (productos por sección, def. 8, máx. 50).
→ `{ totalProducts, sections: [{tag, totalProducts, products: MyProductCard[], pagination}], pagination }`

`MyProductCard`: `id, title, price, discountPercent, finalPrice, currency, imageUrl, status, isVisible, publishedAt, type, condition, tags[], community{id,name} | null`. (No trae `isSaved`.)

**`GET /products/me/stats`** → `{ total, draft, active, sold, inactive }`.

Reactivar un pausado: `PATCH /products/:id/status` `{ "status": "active" }`.

### Reseñas (solo compradores con compra completada)

| Endpoint                                                 |                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /products/:id/reviews` `{ rating: 1-5, comment? }` | 201. En este orden: 404 producto inexistente · 403 si es tu propio producto · 403 si es un producto `exchange` (aún no se pueden reseñar) · 403 si no lo compraste (compra `completed`) · 409 si ya reseñaste. Antes de mostrar el formulario, mira `canReview` en `GET /products/:id`. Detalle de errores en la sección 15. |
| `GET /products/:id/reviews?page=&limit=` (sin sesión)    | `{ ratingAverage, reviewsCount, data: Review[], pagination }`                                                                                                                                                                                                                                                                |
| `PATCH /products/:id/reviews/me`                         | Edita mi reseña (`rating` y/o `comment`). `comment: null` (o vacío) borra el comentario; si no lo mandas, no cambia.                                                                                                                                                                                                         |
| `DELETE /products/:id/reviews/me`                        | Borra mi reseña (204).                                                                                                                                                                                                                                                                                                       |

`Review`: `{ id, productId, rating, comment, createdAt, updatedAt, author{id, username, photoUrl}, isMine }`. Editar y borrar la propia reseña no vuelve a exigir la compra.

Reputación de un usuario: `GET /profiles/:perfilId/reputation` (sin sesión) → `{ userId, isSeller, ratingAverage, reviewsCount, completedSalesCount, ratingDistribution{1..5}, badges[] }`. Si el usuario no es vendedor (o su solicitud está pendiente o fue rechazada): `isSeller: false`, `ratingAverage: null` y conteos en 0.

**Rating del vendedor** (`ratingAverage` / `reviewsCount` en la tienda, el perfil, `seller` del detalle de producto, `GET /users/:id` y esta reputación, junto con `ratingDistribution`): es el promedio (1 decimal) y el total de las reseñas de **todos sus productos, también los que borró** (soft delete). Borrar un producto no cambia el rating del vendedor. Solo cuenta si el vendedor está aprobado; si no, `ratingAverage: null` y conteos en 0. El rating **de un producto** (`GET /products/:id` y `GET /products/:id/reviews`) sigue siendo solo el de sus propias reseñas, y un producto borrado ya no se puede abrir (404).

---

## 7. `isSaved` (favoritos)

**Qué es:** `true` si el usuario autenticado guardó ese producto/post. **Sin sesión siempre es `false`.** Se calcula en cada petición (una consulta por página), sin caché: siempre refleja el estado real al volver a pedir los datos.

**Dónde viene:**

| Objeto      | Endpoints                                                                                                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Productos   | `GET /products`, `/products/shop`, `/products/:id`, `/products/recommended`, `/products/:id/related`, `/search` (products), `/users/:id/products`, productos de `/posts/me`, `/users/:id/posts`, `/favorites/me` |
| Posts       | Todos los feeds y detalle de posts (Home, Explore, global, comunidad, `/forums/me`, `/users/:id/forums`, `/posts/me`, `/favorites/me`, `/search` posts)                                                          |
| **No trae** | `GET /products/me` y las reseñas                                                                                                                                                                                 |

**¿Se actualiza al guardar?** Se recalcula en la **siguiente** petición; lo que ya está en pantalla no cambia solo. El front debe actualizar su estado local:

- Guardar: `PUT /products/:productId/favorite` o `PUT /posts/:postId/favorite` → `{ itemId, itemType, isSaved: true }`. En productos, el body es opcional: `{ notifyPrice?, notifyAvailability? }` activa los avisos al guardar. La respuesta de productos trae también `notifyPrice` y `notifyAvailability`.
- Cambiar avisos de un producto guardado: `PATCH /products/:productId/favorite` `{ notifyPrice?, notifyAvailability? }` → misma forma. No exige que el producto siga activo. 404 si no está guardado y 400 si no manda ningún campo.
- Quitar: `DELETE` a la misma ruta → `{ ..., isSaved: false }`. Un producto se puede quitar aunque ya esté vendido, pausado o borrado.

Recomendado: actualización optimista y revertir si hay error. Un producto solo se puede guardar si está `active` y visible, y si está en una comunidad privada, solo si eres miembro (si no, 404). Si `confirmUnfavorite` es `true`, pide confirmación antes del `DELETE`. Los avisos (los dos apagados por defecto) generan notificaciones de cambio de precio y de disponibilidad: ver [GUIA_NOTIFICACIONES_FRONTEND.md](GUIA_NOTIFICACIONES_FRONTEND.md).

**`GET /favorites/me/ids?type=products|posts`** (def. `products`) → `{ type, ids: [..] }`: cárgalo una vez al iniciar sesión para pintar los corazones. Con `type=products` trae además `items: [{ id, notifyPrice, notifyAvailability }]`.

**`GET /favorites/me?type=all|posts|products&order=desc&page=&limit=`** → pantalla de Favoritos. Formato `data: [{type, date, post|product}]`; `date` = fecha en que se **guardó**. Tabs "Todo / Publicaciones / Tienda" = `type=all|posts|products`.

---

## 8. Mi contenido

| Endpoint                                     | Para qué                                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /forums/me?sortBy=&order=&page=&limit=` | Mis posts de foro. `sortBy`: `hot` (def.) `date` `upvotes` `downvotes` `saves`. → `{data: PostCard[], pagination}` |
| `GET /posts/me?order=&page=&limit=`          | Tab "Todo" de mi perfil: mis posts + productos por fecha (sin borradores).                                         |
| `GET /products/me`                           | Tab "Tienda" del vendedor (sección 6).                                                                             |

Del perfil **de otro usuario**: `/users/:id/posts|forums|products` (solo contenido público).

---

## 9. Búsqueda global

**`GET /search?q=&type=&page=&limit=`** (sin sesión). `q` obligatorio.

- **Con `type`** (`users|posts|products|communities|stores|forums`; `forums` = alias de `posts`) → `{ type, data: [...], pagination }` (limit def. 20, máx. 50). `stores` busca tiendas sin distinguir tildes (ver [GUIA_TIENDA_FRONTEND.md](GUIA_TIENDA_FRONTEND.md)).
- **Sin `type`** → resumen con 5 de cada tipo:

```json
{ "q": "funko",
  "users":       { "data": [PublicUser...], "total": 2 },
  "posts":       { "data": [PostCard...],   "total": 4 },
  "products":    { "data": [ProductListItem...], "total": 9 },
  "communities": { "data": [{id,name,slug,description,imageUrl,bannerUrl}...], "total": 1 },
  "stores":      { "data": [{sellerId,userId,displayName,photoUrl,location,isVerified,ratingAverage,reviewsCount,activeProductsCount}...], "total": 1 } }
```

Los posts de la búsqueda también salen ordenados por votos + frescura. Solo cuentas activas, comunidades **públicas**, productos activos/visibles/no borrados (los sin comunidad también salen).

---

## 10. Badges (insignias)

**El backend no guarda íconos**: los SVG viven en el frontend y se asocian por `code` (contrato estable, no cambia). `name` y `description` vienen en español como respaldo; traduce por `code`.

Todos requieren sesión. Cada ítem tiene **exactamente** esta forma:

```json
{
  "code": "first_post",
  "name": "Primera publicación",
  "description": "Hizo su primera publicación en esta comunidad.",
  "scope": "community",
  "rarity": "common",
  "awardedAt": "2026-10-08T15:30:00.000Z",
  "derived": false
}
```

`rarity`: `common` < `uncommon` < `rare` < `epic` < `legendary`. `scope`: `user` (de la cuenta) o `community` (del perfil en una comunidad). Las listas vienen ordenadas por rareza descendente (legendary primero) y luego `awardedAt` descendente.

| Endpoint                                             | Para qué                                                                                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /badges?scope=user\|community`                  | Catálogo activo (`awardedAt: null`) para pintar también los **bloqueados** (compáralo con los ganados por `code`).                                                  |
| `GET /users/me/badges`                               | Badges de usuario del autenticado.                                                                                                                                  |
| `GET /users/:userId/badges`                          | Badges de usuario de un perfil público.                                                                                                                             |
| `GET /community-profiles/:communityProfileId/badges` | Badges ganados + **derivados** del perfil en esa comunidad. En comunidades privadas solo miembros (403 si no). `communityProfileId` viene en `author` de los posts. |
| `POST /admin/badges/backfill`                        | Solo superadmin: otorga retroactivamente según los datos existentes (idempotente). Devuelve `{ "awarded": { "first_post": 56, ... } }`.                             |

**Derivados:** `community_founder` (rol `owner`) y `moderator` (rol `moderator`) no se guardan: aparecen en `/community-profiles/:id/badges` con `derived: true` y `awardedAt: null` mientras el perfil tenga ese rol (si cambia el rol, desaparecen solos).

Se otorgan **automáticamente** y de forma **asíncrona** (puede tardar un instante): vuelve a pedir la lista; no esperes verlo en la misma respuesta del post/comentario. Son permanentes (no se revocan).

| Code                        | Scope     | Rareza    | Cómo se gana (umbral ajustable en BD)                                                                                                                                        |
| --------------------------- | --------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verified_seller`           | user      | uncommon  | Solicitud de vendedor aprobada                                                                                                                                               |
| `founding_member`           | user      | legendary | Entre los primeros **100** usuarios registrados                                                                                                                              |
| `anniversary`               | user      | rare      | **365** días de cuenta (se evalúa a diario)                                                                                                                                  |
| `trusted_seller`            | user      | rare      | **Aún no se otorga** (falta módulo de transacciones)                                                                                                                         |
| `successful_exchange`       | user      | uncommon  | **Aún no se otorga** (falta módulo de transacciones)                                                                                                                         |
| `first_post`                | community | common    | Primera publicación del perfil en la comunidad                                                                                                                               |
| `talkative`                 | community | uncommon  | **25** respuestas del perfil en la comunidad                                                                                                                                 |
| `community_voice`           | community | rare      | **50** upvotes acumulados en sus posts de la comunidad                                                                                                                       |
| `community_collector`       | community | rare      | **10** entre productos publicados en la comunidad y favoritos (posts/productos) de esa comunidad. Plantilla "Coleccionista de [Franquicia]": ponle el nombre de la comunidad |
| `community_founding_member` | community | epic      | Entre los primeros **25** miembros de la comunidad                                                                                                                           |
| `community_founder`         | community | epic      | Derivado del rol `owner`                                                                                                                                                     |
| `moderator`                 | community | rare      | Derivado del rol `moderator`                                                                                                                                                 |

---

## 11. Superadmin

`GET /users/seller-requests?status=pending|approved|rejected` (por defecto `pending`). Aprobar a un vendedor exige que ese usuario tenga `currency` (400 si no).

---

## 12. Probar todo en Swagger (`http://localhost:3000/api`)

Swagger está en el mismo origen que la API, así que **el navegador manda las cookies solo**.

### Preparación

1. `POST /auth/login` con `{ "identifier": "<email o username>", "password": "<clave>" }`. Para cambiar de usuario: `POST /auth/logout` y vuelve a entrar.
2. Idealmente: un usuario **seller**, uno normal y un superadmin.
3. Al seller: `PATCH /users/me` → `currency = CRC` (obligatorio para publicar).
4. En multipart, los arreglos se escriben como `[1,3,5]`.

### Datos de prueba de foros (Home / Explore)

Hay un script que crea 14 usuarios `seed_*` (contraseña `Test1234`), 7 comunidades nuevas más las existentes, 82 posts con votos/respuestas/favoritos repartidos:

```bash
node scripts/seed-forum-test-data.js          # limpia y siembra
node scripts/seed-forum-test-data.js --clean  # borra solo lo sembrado
```

Imprime los intereses y comunidades de cada usuario. Ej.: `seed_ana` (intereses Pokémon, Manga, Trading Cards; comunidades Lego Builders, Funko Lovers 2, Peluches, Pokémon TCG, Sports Cards, Anime y Manga Hub). Los posts sembrados llevan `[SEED]` en el título.

### A. Feeds (A1–A6)

1. **Sin sesión** (`POST /auth/logout`): `GET /home/posts` → `meta.source = "public"`; `GET /explore/forums/posts` → `meta.personalized = false`; `GET /posts`. Todos devuelven datos y los mejores votados/recientes primero.
2. **Con `seed_ana`**: `GET /home/posts` → `meta.source = "joined"` y **todos** los posts son de sus comunidades. `GET /explore/forums/posts` → mezcla de comunidades donde está y **otras que no** (ej. Hunter x Hunter, Rap), `meta.personalized = true` y `matchedTagCount` según sus intereses.
3. `sort`: `GET /home/posts?sort=new` (cronológico, ignora votos), `?sort=top` (más votos netos), `?sort=hot`. Compara los órdenes.
4. **Dinámico:** con otra pestaña como `seed_*` miembro de esa comunidad, `PUT /posts/{id}/vote` `{ "voteType": "UP" }` varias veces con distintos usuarios; vuelve a pedir `GET /home/posts` y verás subir el post. `{ "voteType": "DOWN" }` lo baja.
5. **Paginación:** `GET /explore/forums/posts?page=1&limit=5` y `page=2`: sin ids repetidos.
6. **Privada:** los posts de la comunidad "Vault privada (seed)" **no** aparecen en Explore/global; con un usuario miembro (ej. `seed_beto`) sí salen en su Home.
7. **Tiempo real:** abre en el navegador `http://localhost:3000/posts/live` (se queda "cargando"); en Swagger vota un post → aparece el evento `post-metrics` en esa pestaña.

### B. Cambio de correo

`POST /auth/request-email-change` → revisa la consola del servidor (sin SMTP imprime `[DEV] Enlace de confirmación...`) → copia el `token` → `POST /auth/confirm-email-change`. Repite el token: 400.

### C. Perfil público

`GET /users/search?q=seed` → copia un `id` → `GET /users/{id}` (sin `email`), `/users/{id}/posts`, `/forums`, `/products`, `/tags`, `/badges`. `GET /users/by-username/seed_ana`.

### D. Preferencias

`PATCH /users/me` con `country=CR`, `currency=crc` (queda `CRC`), `confirmUnfavorite=false`, `pushNotifications=false`; luego `GET /users/me`. `country=XX` y `currency=ABC` → 400.

### E. Productos (como seller)

1. `POST /products` con `title`, `description`, `price=50`, `type=sale`, `condition=new`, `tagIds=[1,3,5]`, `discountPercent=20`, `shipsTo=["CR"]`, imagen → 201. `finalPrice = 40`, `communityId = null`.
2. `POST /communities/{id}/products` (donde eres miembro) → con comunidad. Donde **no** eres miembro → 403.
3. **Borrador:** `POST /products` con `title` + `saveAsDraft=true` → `status: "draft"`. **No** sale en `GET /products` ni `/search`; sí en `GET /products/me?status=draft` y `/products/me/stats` (`draft: 1`).
4. `POST /products/{id}/publish` al borrador incompleto → 400 con la lista. Complétalo con `PATCH` y publica → `active`.
5. **Visibilidad:** `PATCH` `isVisible=false` → desaparece de `GET /products` y shop; sigue en `/products/me`.
6. **Relacionados:** `PATCH` con `relatedProductIds=[<otro producto tuyo activo>]` → `GET /products/{id}/related` lo trae primero con `isSellerChoice: true`. Con un producto de otro vendedor → 400.
7. **Estados:** `PATCH /products/{id}/status` `{status:"inactive"}` y luego `{status:"active"}`. `sold` → intentar `active` da 400.
8. **Mover de comunidad:** `PATCH /products/{id}` con `communityId=<comunidad donde eres miembro>` → cambia. No miembro → 403; inexistente → 404. `communityId=null` (texto `null`) → sin comunidad.
9. `DELETE /products/{id}` → 204. `GET /products/{id}` → 404; ya no sale en ningún listado.
10. Filtros de `GET /products`: `priceMin/priceMax` (sobre el precio final), `currency=CRC`, `shipTo=CR`, `tag`, `communityId`.
11. `GET /products/shop?limit=2&productsLimit=2` → `page=2`: no se repiten productos entre secciones.

### F. Reseñas (usuario **distinto** al dueño)

`POST /products/{id}/reviews` `{rating:5, comment:"..."}` → 201. Repite → 409. Como dueño → 403. `GET /products/{id}/reviews` y `GET /products/{id}` (`ratingAverage`, `reviewsCount`, `seller.ratingAverage`). `PATCH`/`DELETE .../reviews/me`. `GET /users/{idDelVendedor}` → `seller.ratingAverage`.

### G. isSaved y favoritos

1. Sin sesión: `GET /products` → todos `isSaved: false`.
2. Con sesión: `PUT /products/{id}/favorite` → `isSaved: true`.
3. `GET /products`, `/products/{id}`, `/products/shop` → ese producto `isSaved: true`.
4. `GET /favorites/me/ids?type=products` → incluye el id. `GET /favorites/me?type=products`.
5. `DELETE /products/{id}/favorite` → `false`. Repite con un post (`PUT /posts/{id}/favorite`).

### H. Contenido propio

`GET /forums/me?sortBy=upvotes&order=desc`, `GET /posts/me`, `GET /products/me`, `GET /products/me?q=funko&status=active`.

### I. Búsqueda y recomendados

`GET /search?q=funko` (resumen) y `?type=products`. `POST /products/{id}/view` (usuario que **no** sea el dueño) → `GET /products/recommended`; sin sesión `?recentProductIds=22,27`.

### J. Badges

1. `GET /badges` y `GET /badges?scope=community` (catálogo; `scope=xx` → 400).
2. Como un usuario con actividad: `GET /users/me/badges`, `GET /users/{id}/badges`.
3. Crea un post en una comunidad → `first_post` aparece en `GET /community-profiles/{tuProfileId}/badges` (espera unos segundos).
4. Dueño de una comunidad: ese mismo endpoint trae `community_founder` con `derived: true` y `awardedAt: null`.
5. Superadmin: `POST /admin/badges/backfill` (la segunda vez devuelve todo en 0). Con un usuario normal → 403.
6. Perfil de una comunidad **privada** siendo no miembro → 403.

### K. Superadmin

`GET /users/seller-requests` (pendientes) y `?status=approved`.

---

## 13. Resumen de cambios que afectan al front existente

- **Orden de posts:** `GET /posts`, `/communities/:id/posts` y el nuevo Home ordenan por defecto con votos + frescura (`sort=hot`). Usa `sort=new` para el orden cronológico anterior. `/forums/me` y `/users/:id/forums` ahora tienen `sortBy=hot` por defecto.
- **Explore** (`/explore/forums/posts`) ya **no exige sesión**, ya **no** devuelve vacío sin intereses y mezcla popularidad con afinidad; la respuesta añade `meta.personalized`.
- **`GET /posts`** ya no exige sesión. Las tarjetas de post traen `author.photoUrl`.
- **Nuevo:** `GET /home/posts` y el stream `GET /posts/live` (SSE).
- `GET /products/:id`, `/products`, `/products/recommended`, `/products/shop` ya **no exigen sesión** y añaden `finalPrice`, `isSaved`.
- `GET /products/:id/related` devuelve hasta **6** con `isSellerChoice`.
- `GET /users/:id` devuelve **solo datos públicos** (antes todo).
- `community` en tarjetas de producto puede ser **`null`**; `communityId` también. `PATCH /products/:id` acepta `communityId`.
- `/products/shop` y `/products/me`: `page/limit` paginan **secciones** y `productsPage/productsLimit` los productos.
- Crear producto ya **no exige** `image`, `description`, etc. si es borrador; al publicar los errores vienen como arreglo.
- Para publicar, el usuario necesita `currency` (ya no hay USD por defecto).

---

## 14. Stock de productos (`quantity`)

- **Crear:** `quantity` opcional (entero 1–9999, por defecto 1) en `POST /products` y `POST /communities/:id/products`.
- **Editar:** `PATCH /products/:id` acepta `quantity` (0–9999). **0 = agotado**: el producto pasa a `status: "sold"`. Si pasa de 0 a más de 0 vuelve a `active` (reposición). Un producto pausado (`inactive`) o borrador conserva su estado.
- **Marcar vendido a mano** (`PATCH /products/:id/status` `sold`) lo deja con `quantity: 0`. Reactivar un producto sin stock da 400: primero actualiza `quantity`.
- **Respuestas:** todas las tarjetas/listados/detalle traen `quantity` e `isAvailable` (`true` solo si está activo, visible, no borrado **y con stock**). Los agotados no salen en listados públicos ni en shop, pero sí en `/products/me` y en favoritos del usuario (`isAvailable: false`, `status: "sold"`): píntalos como "Agotado".
- **Compra:** `POST /payments/checkout` acepta `quantity` (por defecto 1). El total es **precio unitario × cantidad**. Respuestas: `quantity`, `unitPrice` y `amount` (total). Si pides más que el stock → **409** `Stock insuficiente: solo quedan N unidades`; si ya no hay → **409** `El producto está agotado`. El stock se descuenta atómicamente al aprobarse el pago (no se reserva en el checkout); si el pago falla, no se descuenta.
- **Cotizar:** `GET /payments/quote/:productId?quantity=2` devuelve `quantity`, `unitPrice`, `availableQuantity` y `amount` (total).
- **Notificaciones a favoritos:** solo cuando pasa a agotado o vuelve a estar disponible (no por cada descuento de stock).

---

## 15. Reseñas: `canReview`, `hasReviewed` y `reviewId`

**Regla de negocio:** solo puede reseñar un producto quien lo **compró** (al menos una compra con pago `completed`). Una reseña por usuario y producto (aunque compre varias unidades o varias veces). El vendedor no puede reseñar lo suyo y los productos `exchange` todavía no se reseñan.

### Los tres campos

| Campo         | Tipo           | Significado                                                                           |
| ------------- | -------------- | ------------------------------------------------------------------------------------- |
| `canReview`   | boolean        | Mostrar el formulario / botón "Reseñar".                                              |
| `hasReviewed` | boolean        | El usuario ya tiene una reseña de este producto.                                      |
| `reviewId`    | number \| null | Id de su reseña, para el botón "Editar tu reseña" (`PATCH /products/:id/reviews/me`). |

`canReview` es `true` solo si **todo** esto se cumple: hay sesión · hay una compra `completed` del producto · no tiene reseña propia · no es el vendedor · el producto no es `exchange`.

**Sin sesión:** `canReview: false`, `hasReviewed: false`, `reviewId: null`.

**Dónde vienen:**

- `GET /products/:id` (a nivel de producto, junto a `isSaved`).
- Cada ítem de `GET /payments/me/purchases` (historial de compras): así puedes pintar "Reseñar" / "Editar reseña" en la lista sin pedir el detalle de cada producto. Se calculan en lote (una sola consulta por página).

Las compras en el historial son siempre `completed`; si compró el mismo producto dos veces aparecen dos ítems con los mismos tres valores.

```json
// GET /payments/me/purchases → data[i]
{
  "id": "…",
  "product": { "id": 22, "title": "…" },
  "amount": 25000,
  "productDeleted": false,
  "canReview": true,
  "hasReviewed": false,
  "reviewId": null
}
```

**`productDeleted`** (boolean, solo en `GET /payments/me/purchases`): `true` si el vendedor borró el producto. El historial **sí incluye** esas compras (y su comprobante sigue abriendo), pero `GET /products/:id` responde 404 para ese producto: **no enlaces al detalle** cuando `productDeleted` es `true`; muestra el título/imagen de la compra como texto. Aun así `canReview` sigue la misma regla (si compró, no ha reseñado, etc. puede reseñar con `POST /products/:id/reviews`, y ver las reseñas con `GET /products/:id/reviews`).

### Historial de ventas (vendedor): `GET /payments/me/sales`

También conserva las ventas de productos que el vendedor **borró** (soft delete). Cada ítem trae `productDeleted` (boolean) con el mismo significado que en las compras: si es `true`, **no enlaces al detalle del producto** (da 404) y muestra solo título e imagen de la venta. El comprobante de la venta (`GET /payments/:id`) también sigue abriendo para el vendedor.

```json
// GET /payments/me/sales → data[i]
{
  "id": "…",
  "product": { "id": 22, "title": "…", "imageUrl": "…" },
  "productDeleted": false,
  "buyer": { "id": "…", "username": "…" },
  "amount": 25000,
  "sellerNet": 24250
}
```

### `canComment` (deprecado)

Sigue en `GET /products/:id` con **el mismo valor que `canReview`**, solo por compatibilidad. Deja de usarlo: se eliminará más adelante.

### Casos especiales

- **Producto agotado (`sold`):** se puede reseñar si lo compró; no hace falta que siga a la venta.
- **Producto borrado por el vendedor:** quien lo compró (`completed`) puede seguir reseñándolo y viendo sus reseñas (`GET /products/:id/reviews`), aunque `GET /products/:id` ya responda 404. Sin compra, o sin sesión, esas rutas responden 404. Las reseñas de productos borrados no cuentan en el rating del vendedor.
- **Reembolso:** si una compra pasa a `refunded`, la reseña ya hecha **se conserva** (y sigue editable). Solo se bloquean reseñas nuevas: `canReview` pasa a `false` si no hay otra compra `completed` del mismo producto.
- **Pagos `failed` o `pending`:** no habilitan reseñar.
- **Si borra su reseña**, vuelve a poder reseñar (`canReview: true`, siempre que siga cumpliendo la regla).

### Errores de `POST /products/:id/reviews`

| Código | Mensaje                                                     | Cuándo                                                                           |
| ------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 400    | `rating debe ser un entero entre 1 y 5`                     | rating fuera de rango o decimal.                                                 |
| 403    | `No puedes reseñar tu propio producto`                      | Es el vendedor.                                                                  |
| 403    | `Los productos de intercambio todavía no se pueden reseñar` | Producto `exchange`.                                                             |
| 403    | `Solo puedes reseñar productos que hayas comprado`          | Sin compra `completed` (o solo `failed`, `pending` o `refunded`).                |
| 404    | `Producto no encontrado`                                    | No existe, es un borrador ajeno, o está borrado y no lo compraste.               |
| 409    | `Ya reseñaste este producto`                                | Ya tiene reseña (también si dos peticiones llegan a la vez: solo una se guarda). |

Otras notas:

- Un comentario vacío o de solo espacios se guarda como `null`.
- `GET /products/:id/reviews` devuelve `pagination.totalPages = 1` aunque haya 0 reseñas, y responde 404 para el borrador de otra persona.
- Tras crear, editar o borrar una reseña, vuelve a pedir el detalle (o el historial) para refrescar `canReview`, `hasReviewed` y `reviewId`.
