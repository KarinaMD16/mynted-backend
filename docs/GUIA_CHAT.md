# Mynted – Guía del chat comprador ↔ vendedor

Chat 1 a 1 ligado a un producto: el comprador abre una conversación desde la
ficha de un producto y habla con el dueño de la tienda. Esta guía explica cómo
usarlo desde el frontend y cómo está armado en el backend.

Swagger completo en `http://localhost:3000/api` (tag **conversations**).

**Idea general:** todo lo que **guarda** algo va por **REST** (abrir
conversación, enviar texto o imagen, marcar como leído). **socket.io** solo
**avisa** de los cambios en vivo (mensajes nuevos, leídos, presencia, badge).
Si el socket se cae, la app sigue funcionando con REST.

---

## 1. Conceptos y reglas

| Tema | Regla |
| --- | --- |
| Una conversación por… | `(comprador, vendedor, producto)`. Abrirla dos veces devuelve la misma. |
| `sellerId` | Es el **id de usuario** del dueño de la tienda (`seller.user_id`), no el `sellerId` numérico de la tienda. Ambos participantes son usuarios (uuid). |
| Quién puede abrir | Cualquier usuario autenticado, **excepto** el dueño del producto. |
| Producto no disponible | Si el producto no está `active` o está oculto (`isVisible = false`), **no se pueden abrir conversaciones nuevas**. Las que ya existen siguen legibles y se puede seguir escribiendo (también si se vendió o se borró). |
| Tipos de mensaje | `text` (con `content`) o `image` (con `imageUrl`). |
| Imágenes | El cliente sube el **archivo**; el backend lo sube a Cloudinary y crea el mensaje con la URL resultante. **Nunca** se acepta una URL ni un `type` enviados por el cliente. Las imágenes no llevan pie de foto. |
| Leído | Cada mensaje tiene `readAt` (null = no leído). Lo marca el destinatario con `PATCH /conversations/:conversationId/read`. |
| No leídos | Mensajes **del otro participante** con `readAt` null. Los propios nunca cuentan. |

### Modelo `Message` (lo que devuelven la API y los sockets)

```json
{
  "id": 120,
  "conversationId": 15,
  "senderId": "uuid",
  "type": "text",
  "content": "¿Sigue disponible?",
  "imageUrl": null,
  "createdAt": "2026-10-19T18:20:00.000Z",
  "readAt": null
}
```
En un mensaje `image`: `content` es `null` e `imageUrl` trae la URL de Cloudinary.

### Participante y producto (se repiten en varias respuestas)

```json
"otherParticipant": {
  "id": "uuid",
  "username": "karina",
  "displayName": "Funko Corner CR",
  "photoUrl": "https://…" ,
  "isVerified": true
},
"product": {
  "id": 42,
  "title": "Funko Pop Goku SSJ",
  "price": 25000,
  "finalPrice": 22500,
  "currency": "CRC",
  "imageUrl": "https://… (portada)"
}
```
- `otherParticipant` es siempre **el otro** respecto de quien consulta.
- `displayName` es el nombre de la tienda si es vendedor; si no, su `username`.
- `isVerified` es `seller.isVerified`, y es `false` si no tiene tienda.
- `finalPrice` es el precio con descuento.

---

## 2. Endpoints REST

Todos requieren sesión (cookie `access_token`, `credentials: 'include'`).
Errores con el formato de siempre: `{ statusCode, message, error }`.

| Método y ruta | Para qué |
| --- | --- |
| `POST /conversations` | Abrir (o recuperar) el chat de un producto |
| `GET /conversations` | Bandeja |
| `GET /conversations/unread-count` | Total de no leídos (badge del nav) |
| `GET /conversations/:conversationId/messages` | Historial |
| `POST /conversations/:conversationId/messages` | Enviar texto |
| `POST /conversations/:conversationId/messages/image` | Enviar imagen |
| `PATCH /conversations/:conversationId/read` | Marcar como leído |

Las rutas con `:conversationId` solo las puede usar el comprador o el vendedor
de esa conversación:

| Código | Cuándo |
| --- | --- |
| 400 | `conversationId` no es un entero positivo o pasa de 2147483647 |
| 403 | No participas en esa conversación |
| 404 | La conversación no existe |

### 2.1 `POST /conversations`: botón "Contactar al vendedor"

Body: `{ "productId": 42 }`. El comprador es el usuario autenticado; el
vendedor se deduce del producto.

| Respuesta | Cuándo |
| --- | --- |
| **201** | Se creó la conversación |
| **200** | Ya existía: devuelve la misma (es idempotente) |
| 400 | El producto no está activo o está oculto (solo al crear una nueva) |
| 403 | El producto es tuyo |
| 404 | El producto no existe |

```json
{
  "id": 15,
  "productId": 42,
  "buyerId": "uuid",
  "sellerId": "uuid (usuario dueño de la tienda)",
  "createdAt": "…",
  "lastMessageAt": "…"
}
```
Con 200 o 201, navega al chat con ese `id`.

### 2.2 `GET /conversations`: bandeja

Query: `page` (1), `limit` (20, máx. 50). Ordenada por último mensaje (más
reciente primero).

**Solo aparecen conversaciones con al menos un mensaje.** Abrir un chat y no
escribir nada no ensucia la bandeja de nadie.

```json
{
  "data": [
    {
      "id": 15,
      "otherParticipant": { /* ver sección 1 */ },
      "product": { /* ver sección 1 */ },
      "lastMessage": {
        "id": 120,
        "type": "image",
        "content": null,
        "senderId": "uuid",
        "createdAt": "…"
      },
      "unreadCount": 2,
      "lastMessageAt": "…"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 3, "totalPages": 1 }
}
```
- `lastMessage.type = "image"` indica que el último mensaje fue una imagen;
  muestra algo como "📷 Foto".
- `unreadCount` son los no leídos **tuyos** en esa conversación.

### 2.3 `GET /conversations/unread-count`: badge del nav

```json
{ "totalUnread": 4 }
```
Total de no leídos del usuario en **todas** sus conversaciones. Pídelo al
cargar la app. Después mantenlo al día con el `totalUnread` que traen los
eventos `inbox:message` e `inbox:read` (sección 3.4); no hace falta volver a
pedirlo.

### 2.4 `GET /conversations/:conversationId/messages`: historial

Query: `limit` (30, máx. 100) y `cursor` (opcional). Viene **más recientes
primero**.

```json
{
  "conversation": {
    "id": 15,
    "product": {
      "id": 42, "title": "…", "price": 25000, "finalPrice": 22500,
      "currency": "CRC", "imageUrl": "…",
      "status": "sold",
      "isAvailable": false
    },
    "otherParticipant": { /* ver sección 1 */ }
  },
  "data": [ /* Message, del más nuevo al más viejo */ ],
  "nextCursor": 98
}
```
- **Paginación por cursor:** para cargar mensajes más viejos (scroll hacia
  arriba), pide de nuevo con `?cursor=<nextCursor>`. Si `nextCursor` es
  `null`, no hay más. Un cursor que no es de esa conversación responde 400.
- `isAvailable = false` si el producto ya no está activo, está oculto o fue
  borrado. El chat sigue funcionando; úsalo para mostrar un aviso tipo
  "Este producto ya no está disponible".
- Al pintar, invierte `data` si muestras los más viejos arriba.

### 2.5 `POST /conversations/:conversationId/messages`: enviar texto

Body: `{ "content": "Hola" }`. Responde **201** con el `Message` creado.

- `content` es obligatorio. Se le quitan los espacios de los extremos, no
  puede quedar vacío y tiene un máximo de 2000 caracteres.
- El body **solo** acepta `content`. Mandar `type`, `imageUrl` u otro campo
  responde 400.

### 2.6 `POST /conversations/:conversationId/messages/image`: enviar imagen

`multipart/form-data` con **un único** campo: `image` (el archivo). No mandes
ningún otro campo, ni siquiera de texto.

| Respuesta | Cuándo |
| --- | --- |
| **201** | `Message` con `type: "image"`, `content: null` e `imageUrl` de Cloudinary |
| 400 | Falta el archivo, formato distinto de JPG/PNG/WEBP, imagen inválida o corrupta, o el multipart trae otros campos |
| 413 | La imagen supera 5 MB |
| 502 | Error inesperado al subir; no se creó el mensaje, reintenta |

Si la subida falla, **no** se crea ningún mensaje.

```ts
const form = new FormData();
form.append('image', file);
await fetch(`${API}/conversations/${id}/messages/image`, {
  method: 'POST',
  body: form,
  credentials: 'include',
});
```

### 2.7 `PATCH /conversations/:conversationId/read`: marcar como leído

Sin body. Marca como leídos todos los mensajes **del otro participante** que
estaban sin leer.

```json
{ "conversationId": 15, "markedCount": 3, "readAt": "…" }
```
Es idempotente: si no había pendientes responde 200 con `markedCount: 0` y
`readAt: null`. Puedes llamarlo cada vez que se abre o enfoca el chat.

---

## 3. Tiempo real (socket.io)

Mismo puerto que la API, namespace por defecto.

### 3.1 Conexión y autenticación

```ts
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000', { withCredentials: true });

socket.on('connect_error', (err) => {
  // err.message === 'No autenticado' → sin sesión o token vencido
});
```
- El socket se autentica con la **misma cookie httpOnly `access_token`**
  que la API, así que no hay que mandar ningún token a mano. No se acepta
  `auth.token` ni `Authorization: Bearer`.
- Sin sesión válida, la conexión se **rechaza** y llega `connect_error`.
- Si el navegador conecta desde un origen distinto del frontend permitido
  (`http://localhost:5173`), la conexión se rechaza con `Origen no permitido`,
  aunque haya cookie válida. Esto evita que otra web abra un socket con la
  sesión del usuario (el CORS no protege el transporte WebSocket).
- La sesión solo se valida al conectar. Si el access token vence, refréscalo
  por HTTP (`POST /auth/refresh`) y reconecta.
- Al reconectar se pierden las salas: vuelve a emitir `conversation:join`
  para el chat abierto (en `socket.on('connect', …)`).
- CORS igual que la API: `http://localhost:5173` con credenciales.

### 3.2 Salas

| Sala | Quién está |
| --- | --- |
| `user:{userId}` | Todos los sockets (pestañas, dispositivos) de un usuario; se entra automáticamente al conectar |
| `conversation:{id}` | Los sockets que hicieron `conversation:join` siendo participantes |

### 3.3 Eventos cliente → servidor

Se envían con acknowledgement:

```ts
const ack = await socket
  .timeout(5000)
  .emitWithAck('conversation:join', { conversationId: 15 });
```

| Evento | Payload | Ack si sale bien |
| --- | --- | --- |
| `conversation:join` | `{ conversationId: number }` | `{ ok: true, conversationId, otherParticipant: { userId, online } }` |
| `conversation:leave` | `{ conversationId: number }` | `{ ok: true, conversationId }` |

- `conversationId` debe ser un **número** entero positivo; `"15"` como string
  se rechaza.
- Si falla, el ack es `{ ok: false, error: { status, message } }`:

  | `status` | Cuándo |
  | --- | --- |
  | 400 | Payload inválido (no es un objeto, `conversationId` no es entero, es ≤ 0 o pasa de 2147483647) |
  | 403 | No participas; **no** te une a la sala |
  | 404 | La conversación no existe |

- `otherParticipant.online` dice si el otro está conectado en ese momento.
  Úsalo para el "Activo ahora" inicial.

### 3.4 Eventos servidor → cliente

| Evento | Lo reciben | Payload |
| --- | --- | --- |
| `message:new` | Sala `conversation:{id}` (**incluido quien lo envió**) | `Message` |
| `inbox:message` | Sockets del **destinatario** que **no** están en la sala de esa conversación | `Message` + `totalUnread` |
| `message:read` | Sala `conversation:{id}` | `{ conversationId, readerId, messageIds, readAt }` |
| `inbox:read` | **Todos** los sockets de quien leyó (incluida la pestaña que leyó) | `{ conversationId, unreadCount, totalUnread }` |
| `presence:online` | Usuarios que comparten alguna conversación con él | `{ userId }` |
| `presence:offline` | Ídem | `{ userId }` |
| `exception` | El socket que emitió | `{ status, message, event }`; solo si un evento falló y **no** se mandó con ack |

Detalles:
- **`message:new`** también le llega al **remitente** (está en la sala).
  Deduplica por `id` contra la respuesta del POST.
- **`inbox:message`** es para la bandeja y el badge cuando el chat de esa
  conversación **no** está abierto en ese socket. `totalUnread` es el total
  del destinatario y ya incluye este mensaje.
- **`message:read`** y **`inbox:read`** solo se emiten si se marcó al menos
  un mensaje.
- **`message:read`:** úsalo para los "vistos" (`messageIds` son mensajes tuyos
  que el otro acaba de leer).
- **`inbox:read`:** sincroniza tus otras pestañas o dispositivos.
  `unreadCount` es lo que te queda sin leer en esa conversación (normalmente
  0) y `totalUnread` el total para el badge.
- **Presencia:** `online` llega cuando el usuario abre su **primera**
  pestaña; `offline` cuando cierra la **última**.

### 3.5 Flujo recomendado en el frontend

1. **Al cargar la app (con sesión):**
   - `GET /conversations/unread-count` → badge.
   - Conecta el socket.
   - Escucha `inbox:message` e `inbox:read`: badge = `totalUnread`; si la
     bandeja está en pantalla, sube esa conversación arriba y actualiza su
     `lastMessage` y `unreadCount`.
2. **Ficha de producto, "Contactar":** `POST /conversations` → navega al chat
   con el `id`.
3. **Abrir un chat:**
   - `emitWithAck('conversation:join')` → estado "Activo ahora" inicial.
   - `GET …/messages` → historial.
   - `PATCH …/read`.
4. **Con el chat abierto:**
   - `message:new` de otro → agrégalo y, si la ventana tiene foco, `PATCH …/read`.
   - `message:read` → marca como vistos los `messageIds`.
   - `presence:online` / `presence:offline` con el `userId` del otro → "Activo ahora".
5. **Enviar:** `POST …/messages` (o `…/messages/image`). Pinta el mensaje de
   la respuesta y deduplica cuando llegue el `message:new` propio.
6. **Salir del chat:** `emitWithAck('conversation:leave')`. A partir de ahí
   los mensajes de esa conversación te llegan como `inbox:message`.

Si dos mensajes llegan casi a la vez, los `totalUnread` de los eventos pueden
llegar en desorden y el badge podría quedar un momento con el número viejo.
Si importa, vuelve a pedir `GET /conversations/unread-count` al enfocar la
pestaña.

---

## 4. Para backend: cómo está armado

Todo vive en `src/conversations/` (un módulo por recurso, como el resto del
repo):

| Archivo | Qué hace |
| --- | --- |
| `entities/conversation.entity.ts`, `entities/message.entity.ts` | Tablas `conversation` y `message` (se sincronizan desde las entidades; no hay migraciones) |
| `conversations.controller.ts` | `POST /conversations`, bandeja y `unread-count` |
| `conversation-messages.controller.ts` | Rutas con `:conversationId` (historial, envíos, leído) |
| `conversations.service.ts` | Abrir conversación, bandeja, totales, `findForParticipant` |
| `messages.service.ts` | Historial, envío de texto e imagen, marcar como leído |
| `message-payload.ts` | Única forma de armar `type`/`imageUrl` de un mensaje |
| `guards/conversation-participant.guard.ts` | Solo deja pasar a comprador o vendedor de `:conversationId` |
| `gateway/chat.gateway.ts` | Gateway de socket.io |
| `gateway/chat-presence.ts` | Presencia en memoria |
| `gateway/chat-socket.events.ts` | Nombres de eventos de socket y tipos de payload |
| `conversation-events.ts` | Eventos de dominio internos (EventEmitter2) |
| `../auth/ws-jwt-authenticator.ts` | Autenticación del handshake del socket |

### 4.1 Base de datos

| Tabla | Columnas y restricciones |
| --- | --- |
| `conversation` | `buyer_id` y `seller_id` (uuid → `users`, CASCADE); `product_id` (→ `product`, RESTRICT); `created_at`; `last_message_at` (arranca en `now()` y se adelanta con cada mensaje). Único `(buyer_id, seller_id, product_id)`; índices en `buyer_id`, `seller_id` y `last_message_at`; CHECK `buyer_id <> seller_id`. |
| `message` | `conversation_id` (CASCADE); `sender_id` (→ `users`); `type` (`text`/`image`); `content`; `image_url`; `created_at`; `read_at`. Índice `(conversation_id, created_at)` (historial, último mensaje) e índice parcial `(conversation_id) WHERE read_at IS NULL` (conteos de no leídos y marcar como leído); CHECK que exige `content` en `text` e `image_url` en `image`. |

- **Producto con RESTRICT:** los productos se borran de forma lógica y deben
  conservar sus conversaciones.
- **La bandeja filtra con `EXISTS` sobre `message`:** no con
  `last_message_at`, porque esa columna tiene default `now()` aunque nadie
  haya escrito.

### 4.2 Flujo de un mensaje

1. `ConversationParticipantGuard` valida `:conversationId` y deja la
   conversación en `req.conversation`. Reutilízalo en cualquier ruta nueva
   con `:conversationId`, después de `JwtAuthGuard`.
2. `MessagesService` inserta el mensaje y adelanta `last_message_at` en la
   **misma transacción**, y devuelve el mensaje junto con el `recipientId`.
3. El controller emite un evento de dominio (`ConversationEvents`) con
   `EventEmitter2`, igual que los badges.
4. `ChatGateway` lo escucha con `@OnEvent` y lo reenvía por socket.

`MessagesService` no conoce al gateway. Para agregar un evento de socket nuevo:
emítelo desde el controller después de guardar y agrega un `@OnEvent` en el
gateway.

### 4.3 Cosas a tener en cuenta

- **El `ValidationPipe` global no transforma.** Las rutas del módulo usan su
  propio `ValidationPipe({ transform: true, … })`; sin eso no se aplican los
  defaults de paginación ni el trim de `content`.
- **Orden de rutas:** `GET /conversations/unread-count` es literal. Si algún
  día se agrega `GET /conversations/:conversationId`, debe declararse
  **después**.
- **Errores en sockets:** `WsAckExceptionFilter` devuelve el error por el ack
  conservando el status (403, 404, 400). El filtro por defecto de Nest los
  convertiría en "Internal server error".
- **Ids `int4`:** los ids de conversación, mensaje y producto son `int4`. Los
  DTOs y el guard rechazan con 400 los mayores a 2147483647 (`dto/int-id.ts`);
  si no, Postgres fallaría con un 500.
- **Presencia:** nunca emitas a `server.to([])`. En socket.io, una lista de
  salas vacía significa **todos** los sockets. `broadcastPresence` corta
  antes si el usuario no tiene contrapartes.
- **Cloudinary:** se usa el `CloudinaryService` del repo. Ese servicio
  convierte cualquier error del SDK (incluso de red) en 400 "imagen inválida";
  por eso el 502 solo aparece ante errores inesperados. Si la subida funciona
  pero falla el insert, la imagen queda huérfana en Cloudinary.

### 4.4 Limitación: una sola instancia

La presencia (`userId → sockets`) y las salas de socket.io viven **en
memoria**. Con varias instancias del backend, cada una solo ve sus propios
sockets: un mensaje creado en una instancia no llega a los clientes de otra, y
la presencia sale incompleta. Para escalar hace falta un adaptador compartido
(por ejemplo `@socket.io/redis-adapter`) y mover la presencia a Redis.

### 4.5 Límites conocidos (pendientes)

- **Socket y sesión:** la sesión del socket solo se valida al conectar. Un
  socket abierto sigue recibiendo eventos aunque el access token venza o el
  usuario cierre sesión en esa pestaña. El frontend debe hacer
  `socket.disconnect()` al cerrar sesión.
- **Presencia con conversaciones vacías:** se comparte con quien tenga una
  conversación con el usuario, aunque no tenga mensajes. Cualquier comprador
  que abra un chat sobre un producto activo puede ver si el vendedor está
  conectado.
- **Ids secuenciales:** los ids de conversación son secuenciales, y la
  diferencia entre 403 (existe pero no es tuya) y 404 (no existe) revela
  cuántas conversaciones hay. No expone contenido.
- **`totalUnread` en desorden:** puede llegar en desorden si entran dos
  mensajes casi a la vez (ver 3.5).
- **Sin límite de frecuencia:** no hay rate limit para enviar mensajes ni para
  `conversation:join`.

---

## 5. Pruebas

```bash
npm run test       # unitarias
npm run test:e2e   # e2e (HTTP y sockets)
```

- **`test:e2e` corre siempre contra la base `mynted_db_e2e`** (o la que diga
  `E2E_DB_NAME`), nunca contra `DB_NAME`:
  - `test/e2e-env.ts` la fuerza antes de cada suite.
  - `test/e2e-global-setup.ts` la crea si no existe y aborta si coincide con
    la base de desarrollo.
- Cada suite **recrea el esquema** de esa base. Corren de a una
  (`maxWorkers: 1`) porque comparten la base.
- **Suites del chat:**
  - `test/conversations.e2e-spec.ts`: flujo HTTP completo.
  - `test/unread-count.e2e-spec.ts`: badge de no leídos.
  - `test/chat.e2e-spec.ts`: sockets con clientes `socket.io-client` reales.
- `test/utils/chat-test-app.ts` levanta la app mínima y siembra comprador,
  vendedor (tienda verificada), un tercero y un producto. Cloudinary es un
  fake: no se sube nada real.

### Probar a mano en Swagger

1. Inicia sesión con dos usuarios distintos (por ejemplo en dos navegadores):
   uno **vendedor** con un producto activo y otro **comprador**.
2. Como comprador: `POST /conversations` con el `productId`. Debe dar 201, y
   200 si lo repites.
3. Como comprador: `POST /conversations/{id}/messages` con `{ "content": "Hola" }`.
4. Como vendedor:
   - `GET /conversations/unread-count` → `1`.
   - `GET /conversations` → aparece la conversación con `unreadCount: 1`.
5. Como vendedor: `PATCH /conversations/{id}/read` → `markedCount: 1`. Repetir
   da `0`.
6. Como vendedor: `POST /conversations/{id}/messages/image` con un JPG/PNG/WEBP.
7. Como un tercer usuario: `GET /conversations/{id}/messages` → 403.
