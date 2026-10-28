# Guía de notificaciones para el frontend

Notificaciones dentro de la app: la campana con su contador, la lista y los avisos en vivo por socket. Incluye los avisos de productos favoritos (tarea 1044).

**Resumen:**
- Toda notificación **se guarda siempre**: se puede leer después con `GET /notifications`.
- Además se emite **en vivo** por socket.io a todas las pestañas y dispositivos abiertos del usuario.
- El texto lo arma el front a partir de `type` + `data`. El campo `message` es solo un respaldo en español.

---

## 1. Forma de una notificación

```json
{
  "id": "0b8f6c2e-7a1d-4c55-9a8e-2f1d3c4b5a6e",
  "type": "favorite_price_changed",
  "data": {
    "productId": 22,
    "productTitle": "Funko Pop Goku SSJ",
    "previousPrice": 25000,
    "newPrice": 22500,
    "currency": "CRC"
  },
  "message": "Cambió el precio de \"Funko Pop Goku SSJ\": ahora 22500 CRC",
  "readAt": null,
  "createdAt": "2026-10-21T22:30:00.000Z"
}
```

| Campo | Notas |
|---|---|
| `type` | Uno de los de la sección 4. Usa esto, no `message`, para decidir el texto y el ícono. |
| `data` | Lo mínimo para armar el texto y el enlace: ids, nombres y montos. Nunca trae descripciones ni comentarios. |
| `message` | Texto de respaldo en español (por ejemplo, si llega un `type` que el front no conoce). |
| `readAt` | `null` si no está leída. |
| `createdAt` | Al unificar (ver sección 6) **se renueva**: la notificación vuelve arriba. |

---

## 2. Socket.io

Es la **misma conexión del chat** (ver [GUIA_CHAT.md](GUIA_CHAT.md)): mismo servidor y la misma cookie de sesión. No hay que abrir otro socket ni unirse a ninguna sala; el backend ya mete cada socket en la sala del usuario.

| Evento (servidor → cliente) | Payload | Cuándo |
|---|---|---|
| `notification:new` | `{ notification, unreadCount }` | Notificación nueva, o una unificada que volvió arriba con datos nuevos. |
| `notification:unread-count` | `{ unreadCount }` | El contador cambió por leer, marcar todas o borrar (sincroniza las otras pestañas). |

```ts
socket.on('notification:new', ({ notification, unreadCount }) => {
  setBadge(unreadCount);
  upsertNotification(notification); // por id: una unificada reemplaza la anterior
  if (user.pushNotifications) showToast(notification); // ver sección 7
});
socket.on('notification:unread-count', ({ unreadCount }) => setBadge(unreadCount));
```

Haz un upsert por `id`: cuando una notificación se unifica llega con **el mismo `id`**, otro `type`/`data` y un `createdAt` nuevo.

---

## 3. REST

Todos requieren sesión. Cada usuario solo ve y modifica las suyas: la de otro usuario responde 404 igual que una inexistente.

| Endpoint | Respuesta |
|---|---|
| `GET /notifications?page=1&limit=20&unread=true` | `{ data: Notification[], pagination: { page, limit, total, totalPages } }`, de la más reciente a la más antigua. `limit` máximo 50. `unread=true` trae solo las no leídas. |
| `GET /notifications/unread-count` | `{ unreadCount: 3 }` (para el badge al cargar la app) |
| `PATCH /notifications/:id/read` | La notificación con `readAt`. Si ya estaba leída no cambia. |
| `PATCH /notifications/read-all` | `{ updated: 3, unreadCount: 0 }` |
| `DELETE /notifications/:id` | 204 |

```http
GET /notifications?page=1&limit=20
```
```json
{
  "data": [
    {
      "id": "…",
      "type": "sale_completed",
      "data": {
        "transactionId": "8c9e4e3c-…",
        "productId": 22,
        "productTitle": "Funko Pop Goku SSJ",
        "amount": 25000,
        "currency": "CRC",
        "buyerUsername": "ana"
      },
      "message": "Vendiste \"Funko Pop Goku SSJ\" a ana",
      "readAt": null,
      "createdAt": "2026-10-21T22:30:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

---

## 4. Tipos, `data` y a dónde llevar

| `type` | A quién | `data` | Al tocarla, ir a |
|---|---|---|---|
| `favorite_price_changed` | quien guardó el producto con `notifyPrice` | `productId, productTitle, previousPrice, newPrice, currency` | detalle del producto |
| `favorite_unavailable` | quien lo guardó con `notifyAvailability` | `productId, productTitle, reason` (`sold`, `inactive`, `hidden` o `deleted`) | detalle del producto, salvo si `reason` es `deleted` (ya no existe) |
| `favorite_available_again` | ídem | `productId, productTitle` | detalle del producto |
| `purchase_completed` | comprador | `transactionId, productId, productTitle, amount, currency, sellerName` | recibo `GET /payments/:transactionId` |
| `sale_completed` | vendedor | `transactionId, productId, productTitle, amount, currency, buyerUsername` | recibo o historial de ventas |
| `review_received` | dueño del producto | `reviewId, productId, productTitle, rating, authorUsername` | reseñas del producto |
| `badge_awarded` | quien lo gana | `badgeCode, badgeName, rarity, scope`; si es de comunidad, también `communityProfileId, communityId, communityName, communitySlug` | perfil (o perfil en la comunidad); el SVG se asocia por `badgeCode` |
| `community_join_requested` | owner y moderadores | `requestId, communityId, communityName, communitySlug, requesterId, requesterUsername` | solicitudes de la comunidad |
| `community_join_accepted` | quien la pidió | `requestId, communityId, communityName, communitySlug` | la comunidad |
| `community_join_rejected` | quien la pidió | ídem | — |
| `seller_request_approved` | el usuario | `sellerId, displayName` | su tienda `/sellers/:sellerId` |
| `seller_request_rejected` | el usuario | `{}` | — |
| `post_replied` | autor del post | `postId, postTitle, replyId, communityId, communitySlug, authorUsername` | el post, en la respuesta `replyId` |
| `reply_replied` | autor de la respuesta respondida | lo mismo + `parentReplyId` | ídem |
| `subscription_payment_confirmed` | quien pagó Pro | `paymentId, period, amount, currency, startsAt, endsAt, renewal` | su suscripción (`GET /subscriptions/me`) |
| `subscription_expiring_soon` | quien tiene Pro por vencer (3 días antes) | `subscriptionId, period, endsAt, daysRemaining, cancelAtPeriodEnd` | pantalla de planes para renovar |
| `subscription_expired` | quien dejó de ser Pro | `subscriptionId, period, endsAt` | pantalla de planes para renovar |

Las tres de suscripción están explicadas en la [guía de Pro](GUIA_PRO_FRONTEND.md#notificaciones): `amount` va en USD (lo que se cobró) y las fechas son ISO. En `subscription_expiring_soon`, si `cancelAtPeriodEnd` es `true` el usuario canceló la renovación: el texto debe invitar a pagar de nuevo, no a "renovar".

Los montos van en la moneda original de la transacción o del producto, no en la de visualización. Si quieres mostrarlos convertidos, usa las tasas de la [guía de moneda](GUIA_MONEDA_FRONTEND.md).

---

## 5. Qué acción notifica a quién

| Acción | Notificación | Nunca se avisa a |
|---|---|---|
| El vendedor cambia el **precio final** (precio o descuento) | `favorite_price_changed` a quien lo guardó con aviso de precio | el vendedor |
| El producto **deja de estar disponible** (vendido, pausado, oculto o borrado) | `favorite_unavailable` | el vendedor; en una venta, tampoco el comprador |
| Vuelve a estar **disponible** (activo, visible y no borrado) | `favorite_available_again` | el vendedor |
| Pago aprobado | `purchase_completed` al comprador y `sale_completed` al vendedor | — |
| Reseña nueva | `review_received` al vendedor | quien reseñó |
| Badge ganado **por una acción** | `badge_awarded` | — (el badge de aniversario y los otorgados retroactivamente no notifican) |
| Pedir unirse a una comunidad privada | `community_join_requested` a owner y moderadores | quien la pidió |
| Aceptar o rechazar la solicitud | `community_join_accepted` o `community_join_rejected` a quien la pidió | — |
| Aprobar o rechazar una solicitud de vendedor | `seller_request_approved` o `seller_request_rejected` | — |
| Pago de Pro aprobado | `subscription_payment_confirmed` (una sola vez; repetir la misma `Idempotency-Key` no vuelve a notificar) | — |
| Faltan 3 días o menos para `endsAt` de Pro | `subscription_expiring_soon` (una vez por vencimiento; si renueva y vuelve a estar por vencer, avisa otra vez) | cuentas desactivadas |
| Vence Pro | `subscription_expired` (una vez por vencimiento, hasta 7 días después) | cuentas desactivadas |
| Responder un post | `post_replied` al autor del post | quien respondió |
| Responder una respuesta | `reply_replied` al autor de esa respuesta y `post_replied` al autor del post | quien respondió. Si el autor del post es también el de la respuesta, recibe **una sola** (`reply_replied`). |

Reglas generales:
- **Cuentas desactivadas:** no reciben notificaciones.
- **Precio:** solo avisa si cambia el **precio final**. Cambiar el título o las fotos, o subir el precio y el descuento sin que cambie el final, no notifica.
- **Disponibilidad:** solo avisa en transiciones reales. Si un producto oculto pasa a pausado, sigue sin estar disponible y no notifica.
- **Comunidades privadas:** si el producto está en una comunidad privada (o se movió a una), solo avisan a quienes son miembros.

---

## 6. Unificación (solo precio y disponibilidad)

Para no llenar la campana cuando el vendedor hace varios cambios seguidos, hay **una sola notificación no leída por producto y por tipo de aviso**:

- **Precio:** si ya tienes una no leída, se actualiza en lugar de crear otra. Conserva el `previousPrice` de la primera (el precio que viste) y actualiza `newPrice`. Si el precio vuelve a quedar igual al que viste, la notificación se **borra** (llega `notification:unread-count`).
- **Disponibilidad:** la no leída refleja el último estado. Por ejemplo, si se pausa y se reactiva, queda como `favorite_available_again`.
- **Al actualizarse**, la notificación renueva `createdAt`, vuelve arriba y llega de nuevo por `notification:new` con el mismo `id`.
- **Una vez leída**, el siguiente cambio crea una notificación nueva.

Reseñas, respuestas y los demás tipos **no** se unifican.

---

## 7. `pushNotifications` y `emailNotifications`

- **El tiempo real no depende de ninguna preferencia:** el socket emite `notification:new` siempre.
- **`pushNotifications`** (en `GET /users/me`) está reservado para el push real del navegador o del móvil, que llegará en otra fase. Hoy el front puede usarlo para decidir si muestra un **aviso emergente** al recibir `notification:new`. La campana y el contador se actualizan igual.
- **`emailNotifications`:** todavía no se envían correos de notificaciones.

---

## 8. Avisos de productos favoritos (tarea 1044)

Detalle de los endpoints en [GUIA_FRONTEND.md](GUIA_FRONTEND.md), sección de favoritos. Resumen:

| Endpoint | Para qué |
|---|---|
| `PUT /products/:productId/favorite` con body opcional `{ notifyPrice?, notifyAvailability? }` | Guardar y activar avisos en un paso. Sin body, guarda sin avisos (o deja los que ya tenía). |
| `PATCH /products/:productId/favorite` `{ notifyPrice?, notifyAvailability? }` | Cambiar los avisos (por ejemplo, desde el menú del corazón). No exige que el producto siga activo. 404 si no está guardado y 400 sin campos. |
| `GET /favorites/me/ids?type=products` | Además de `ids`, trae `items: [{ id, notifyPrice, notifyAvailability }]`. |
| `GET /favorites/me` y otras tarjetas de producto | Cada producto trae `notifyPrice` y `notifyAvailability` de quien mira (`false` si no lo guardó). |

Por defecto los dos avisos están **apagados**.

---

## 9. Retención

Las notificaciones **leídas** se borran a los **90 días** y las **no leídas** a los **180**, en una limpieza diaria. No hay que hacer nada en el front.
