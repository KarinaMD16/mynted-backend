# API de moderación, reportes y administración

Documentación de integración para frontend basada en el código actual de Mynted.

## Autenticación y permisos

Los endpoints protegidos usan:

~~~http
Authorization: Bearer <access_token>
~~~

Hay dos niveles:

- Moderación comunitaria: OWNER y MODERATOR mediante CommunityRoleGuard.
- Administración global: SUPERADMIN mediante SuperAdminGuard.

| Funcionalidad | Usuario | Member | Moderator | Owner | SUPERADMIN |
|---|---:|---:|---:|---:|---:|
| Crear reportes | Sí | Sí | Sí | Sí | Sí |
| Ver/resolver reportes comunitarios | No | No | Sí | Sí | Según guard comunitario |
| Reportes globales | No | No | No | No | Sí |
| Moderation log | No | No | No | No | Sí |
| Administración global | No | No | No | No | Sí |

Errores habituales: 400 datos o acción inválida, 401 sin autenticación, 403 sin permiso, 404 objetivo inexistente/no disponible y 409 conflicto o duplicado.

## Privacidad de los reportes

Los reportes son anónimos para frontend. La identidad del usuario que reportó se conserva internamente mediante `reporterId` para integridad, prevención de duplicados y lógica del sistema, pero no se devuelve en las respuestas API de moderación.

OWNER, MODERATOR y SUPERADMIN reciben los reportes sin identidad del reportante. `resolvedByUser`, cuando existe, representa al moderador o SUPERADMIN que procesó el reporte; no representa al usuario que lo creó.

## Enums

ReportItemType:

~~~text
post
reply
product
conversation
community
~~~

ReportReason:

~~~text
spam
fake_product
offensive_language
harassment
inappropriate_content
other
~~~

ReportStatus:

~~~text
pending
resolved
dismissed
~~~

## Crear reportes

### POST /reports

Guard: JwtAuthGuard. Respuesta exitosa: 201.

~~~json
{
  "itemType": "post",
  "itemId": 3,
  "reason": "spam",
  "description": "Contenido repetido"
}
~~~

Campos:

| Campo | Tipo | Requerido | Notas |
|---|---|---:|---|
| itemType | enum | Sí | Uno de los cinco valores. |
| itemId | integer positivo | Sí | ID del objetivo. |
| reason | enum | Sí | Un valor de ReportReason. |
| description | string | No | Máximo 2000 caracteres; no puede quedar vacío. |

### Reportar una comunidad

No existe endpoint separado:

~~~json
{
  "itemType": "community",
  "itemId": 2,
  "reason": "spam",
  "description": "Revisión necesaria"
}
~~~

Se guarda itemId = community.id y communityId = community.id.

Reglas actuales:

- pública: cualquier usuario autenticado;
- privada: el usuario debe tener CommunityProfile;
- inactiva pero no soft-deleted: puede reportarse;
- inexistente o soft-deleted: 404;
- member, moderator y owner pueden reportarla;
- no se aplica self-report automático por pertenencia;
- una comunidad sin owner también puede reportarse.

Para post, reply y product el target debe existir y su autor no puede reportar su propio contenido. Para conversation, el usuario debe ser buyer o seller participante.

Un mismo usuario no puede reportar dos veces el mismo itemType + itemId: recibe 409. Otro usuario sí puede reportarlo.

communityId puede ser null para objetivos globales, como una conversación o producto sin comunidad.

## Reportes de una comunidad

### GET /communities/:communityId/reports

Guards: JWT + CommunityRoleGuard; roles MODERATOR u OWNER.

Query:

| Parámetro | Default | Restricciones |
|---|---:|---|
| status | — | pending, resolved, dismissed |
| page | 1 | mínimo 1 |
| limit | 20 | 1–100 |

Orden: createdAt DESC, luego id DESC.

~~~json
{
  "data": [
    {
      "id": 10,
      "reason": "spam",
      "status": "pending",
      "itemType": "post",
      "itemId": 2,
      "excerpt": { "title": "Publicación", "text": "Contenido reportado" },
      "contentUnavailable": false,
      "createdAt": "2026-10-28T12:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 },
  "counts": { "pending": 1, "resolved": 0, "dismissed": 0 }
}
~~~

counts contiene totales por estado de la comunidad. Los reports cuyo itemType es community no aparecen en este listado ni en sus counts; este panel solo muestra contenido que OWNER/MODERATOR pueden gestionar.

### GET /communities/:communityId/reports/:id

Mismos guards y roles. Devuelve description, estado, resolución y content, sin identidad del reportante.

Para una comunidad, content puede ser:

~~~json
{
  "id": 2,
  "name": "Comunidad",
  "slug": "comunidad",
  "description": "Descripción",
  "isActive": true,
  "isPrivate": false,
  "deletedAt": null
}
~~~

También pueden venir resolvedAt, resolvedByUser, resolutionAction, resolutionNote, createdAt y updatedAt.

## Excerpt y contenido no disponible

| Tipo | title | text |
|---|---|---|
| post | título | cuerpo truncado |
| reply | null | cuerpo truncado |
| product | título | descripción truncada |
| conversation | producto | último mensaje o [Imagen] |
| community | nombre | descripción truncada |

El truncado actual es aproximadamente de 160 caracteres.

contentUnavailable true indica que el target ya no pudo cargarse. El reporte no desaparece y excerpt puede ser null.

## Resolver y descartar

### PATCH /communities/:communityId/reports/:id/resolve

Guards: JWT + CommunityRoleGuard; roles MODERATOR y OWNER.

~~~json
{
  "hideContent": false,
  "warnAuthor": false,
  "note": "Revisión administrativa realizada"
}
~~~

Debe existir al menos una acción real.

| itemType | hideContent | warnAuthor | note | dismiss |
|---|---:|---:|---:|---:|
| post | Sí | Sí | Sí | Sí |
| reply | Sí | Sí | Sí | Sí |
| product | Sí | Sí | Sí | Sí |
| conversation | No | Según target | Sí | Sí |
| community | No | No | Sí | Sí |

Para community solo mostrar resolver con nota y descartar. hideContent true, warnAuthor true y combinaciones con note producen 400. No se busca owner como sustituto de autor ni se modifica la comunidad.

Resolver community con nota:

- cambia pending a resolved;
- guarda resolutionAction = note y resolutionNote;
- registra report_resolved;
- no genera notificación adicional.

Para post, reply y product compatibles, ocultar registra content_hidden, resuelve el reporte y puede notificar al propietario. Si existen varios reports pendientes del mismo target, pueden resolverse en lote. Esto no aplica a communities.

warnAuthor envía moderation_warning al autor/propietario cuando aplica y registra author_warned. No oculta contenido.

### PATCH /communities/:communityId/reports/:id/dismiss

Mismos guards. Cambia pending a dismissed, no modifica el target, no genera notificación adicional y registra report_dismissed.

Un report ya resuelto o descartado produce 409.

## Estadísticas y restauración

### GET /communities/:communityId/moderation/stats

JWT + moderator/owner.

~~~json
{
  "pendingReports": 0,
  "resolvedToday": 0,
  "activeMembers": 0,
  "activeModerators": 0
}
~~~

pendingReports incluye reportes de la comunidad, incluidos los de tipo community.

### PATCH /communities/:communityId/moderation/:itemType/:itemId/restore

JWT + moderator/owner. Restaura post, reply y product según ModerationItemType. No restaura communities. Es idempotente y, cuando cambia de oculto a visible, registra content_restored.

## Reportes globales

### GET /reports

JWT + SuperAdminGuard.

Query: status, itemType, communityId, page y limit.

- status: pending, resolved o dismissed;
- itemType: post, reply, product, conversation o community;
- communityId: entero positivo;
- page: default 1, mínimo 1;
- limit: default 20, máximo 100.

Ejemplos:

~~~http
GET /reports?status=pending
GET /reports?itemType=community
GET /reports?communityId=2
GET /reports?status=pending&itemType=community&page=1&limit=20
~~~

Orden: createdAt DESC, id DESC.

La respuesta tiene data, pagination y counts. Cada elemento incluye id, reason, status, itemType, itemId, excerpt, contentUnavailable y createdAt; el listado global agrega communityId y community. `reporter` y `reporterId` no forman parte de la respuesta.

### PATCH /reports/:id/resolve

JWT + SuperAdminGuard. Tiene el mismo body y reglas. Permite resolver reports de community, incluso históricos con target soft-deleted, usando note.

### PATCH /reports/:id/dismiss

JWT + SuperAdminGuard. No requiere communityId en la URL y permite descartar reports normales o históricos.

### Notificaciones de Community Reports

- Mientras un Community Report está `pending`, el OWNER no recibe ninguna notificación.
- Si el SUPERADMIN descarta el reporte, no se envía ninguna notificación.
- Si el SUPERADMIN lo resuelve con una nota válida, el OWNER recibe una notificación `community_moderation_warning`.
- La notificación es genérica y contiene únicamente `communityId` y `communityName`.
- No incluye `reportId`, `reporter`, `reporterId`, `reason`, `description` ni `resolutionNote`.
- El OWNER no obtiene acceso al reporte; los Community Reports siguen siendo gestionables exclusivamente por SUPERADMIN.

## Moderation log

### GET /moderation-log

JWT + SuperAdminGuard.

Query: todos los filtros son opcionales y combinables con lógica AND. `page` default 1, `limit` default 20 y máximo 100. Orden: createdAt DESC, id DESC.

| Parámetro | Tipo | Uso |
|---|---|---|
| action | string/enum | Acción auditada. |
| targetType | string/enum | Tipo de objetivo. |
| targetId | string | ID exacto del objetivo; acepta números o UUID. |
| communityId | integer positivo | Comunidad relacionada. |
| actorUserId | UUID | Usuario que ejecutó la acción. |
| from | ISO date-time | `createdAt >= from`. |
| to | ISO date-time | `createdAt <= to`. |
| page | integer | Página, mínimo 1. |
| limit | integer | Tamaño, entre 1 y 100. |

Ejemplos:

~~~http
GET /moderation-log?action=report_resolved
GET /moderation-log?targetType=community
GET /moderation-log?communityId=2
GET /moderation-log?actorUserId=<uuid>
GET /moderation-log?from=2026-10-01T00:00:00.000Z&to=2026-10-31T23:59:59.999Z
GET /moderation-log?action=report_resolved&communityId=2&page=1&limit=20
~~~

`from` y `to` son inclusivos; `from` no puede ser posterior a `to`. Los valores inválidos devuelven 400.

~~~json
{
  "data": [
    {
      "id": 10,
      "action": "report_resolved",
      "targetType": "report",
      "targetId": "15",
      "reason": null,
      "communityId": 2,
      "createdAt": "2026-10-28T12:00:00.000Z",
      "actor": {
        "id": "uuid",
        "username": "moderador",
        "photoUrl": null,
        "role": "user"
      }
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
~~~

Acciones definidas actualmente:

~~~text
content_hidden, content_restored, report_resolved, report_dismissed,
author_warned, user_deactivated, user_reactivated, user_soft_deleted,
seller_revoked, seller_restored, product_deactivated, product_activated,
product_soft_deleted, community_deactivated, community_activated,
community_made_public, community_made_private, community_soft_deleted
~~~

El log es histórico y append-only. targetId llega como string. El actor no expone email, password ni tokens.

## Administración de usuarios

| Método | Endpoint | Permiso | Uso |
|---|---|---|---|
| GET | /users | SUPERADMIN | Listado y filtro sellerStatus. |
| GET | /users/:id | JWT | Detalle de usuario. |
| PATCH | /users/:id/deactivate | SUPERADMIN | Desactivar usuario. |
| PATCH | /users/:id/activate | SUPERADMIN | Reactivar usuario. |
| DELETE | /users/:id | SUPERADMIN | Soft delete de usuario. |
| GET | /users/stats | SUPERADMIN | Estadísticas globales. |

GET /users admite sellerStatus: none, pending, approved, rejected, revoked.

Desactivar y eliminar requieren:

~~~json
{ "reason": "Incumplimiento de normas" }
~~~

El motivo se recorta y admite máximo 500 caracteres. Desactivar devuelve isActive false; activar devuelve isActive true. Soft delete devuelve deletedAt y no es eliminación física.

## Administración de vendedores

### PATCH /users/:id/seller-status

JWT + SuperAdminGuard. El body es UpdateSellerStatusDto; sus campos exactos están reflejados en Swagger.

Al revocar:

- el seller deja de estar verificado;
- productos activos pasan a inactive según el flujo;
- SellerGuard deja de permitir operaciones de vendedor;
- se registra seller_revoked y se notifica.

Al restaurar:

- vuelve a aprobado/verificado;
- se registra seller_restored;
- los productos no se reactivan automáticamente.

Rutas adicionales:

~~~text
GET /users/seller-requests
GET /users/seller-request/:id
~~~

## Administración de productos

| Método | Endpoint | Permiso |
|---|---|---|
| PATCH | /products/:id/deactivate | SUPERADMIN |
| PATCH | /products/:id/activate | SUPERADMIN |
| DELETE | /products/:id | JWT, propietario |
| PATCH | /products/:id/status | JWT, propietario |

Las acciones administrativas requieren:

~~~json
{ "reason": "Incumplimiento de políticas comerciales" }
~~~

El motivo es obligatorio y admite máximo 500 caracteres.

| Campo | Significado |
|---|---|
| status | draft, active, sold o inactive; estado comercial. |
| isDeactivated | Bloqueo administrativo. |
| isHidden | Ocultamiento por moderación. |
| isVisible | Visibilidad configurada. |
| deletedAt | Soft delete. |

Desactivar pone isDeactivated true, no equivale necesariamente a cambiar status, isHidden o isVisible, y registra product_deactivated. Activar retira la desactivación y no publica automáticamente un producto.

## Administración de comunidades

### GET /communities/all

JWT + SuperAdminGuard.

Query:

~~~text
search
categoryId, entero positivo
isActive, boolean
isPrivate, boolean
page, default 1
limit, default 10, máximo 100
~~~

Incluye activas, inactivas, públicas, privadas y soft-deleted según filtros. Devuelve memberCount, productCount, pendingReportsCount y deletedAt.

Una community sin perfiles aparece con memberCount 0. Una community creada por SUPERADMIN sin owner es válida.

### POST /communities

JWT y multipart/form-data.

Requeridos: name, description, slug, isPrivate, categoryId, tagIds y rules. Opcionales: ownerId, image y banner.

- usuario normal: se convierte en owner y no puede elegir owner arbitrario;
- SUPERADMIN con ownerId: puede asignarlo;
- SUPERADMIN sin ownerId: puede dejarla sin owner.

### Acciones

| Método | Endpoint | Permiso |
|---|---|---|
| PATCH | /communities/:communityId/deactivate | Owner |
| PATCH | /communities/:communityId/activate | Owner |
| PATCH | /communities/:communityId/public | Owner |
| PATCH | /communities/:communityId/private | Owner |
| DELETE | /communities/:id | SUPERADMIN |

Las primeras cuatro usan JWT + CommunityRoleGuard y requieren OWNER. Delete usa JWT + SuperAdminGuard y body con reason. Es un soft delete y conserva historia.

## Estadísticas administrativas

### GET /users/stats

JWT + SuperAdminGuard.

~~~json
{
  "totalUsers": 0,
  "approvedSellers": 0,
  "activeCommunities": 0,
  "activeProducts": 0,
  "pendingReports": 0
}
~~~

- totalUsers: usuarios no soft-deleted, incluidos inactivos.
- approvedSellers: seller verificado, rol seller, solicitud aprobada, usuario activo/no eliminado.
- activeCommunities: isActive true y no eliminadas.
- activeProducts: status active, no eliminados, no desactivados, no ocultos, visibles, seller aprobado y usuario activo/no eliminado.
- pendingReports: todos los reports globales pending.

## Notificaciones relevantes

Valores confirmados relacionados:

~~~text
content_hidden
content_restored
moderation_warning
user_deactivated
user_reactivated
seller_revoked
seller_restored
product_deactivated
product_activated
community_deactivated
community_activated
community_made_public
community_made_private
community_deleted
~~~

Resolver con nota o descartar un report no genera notificación adicional de community. Una notificación no es por sí sola un sistema de strikes.

## Estados, nulabilidad y soft delete

| Recurso | Campos | Significado |
|---|---|---|
| User | isActive, deletedAt | Inactividad y soft delete distintos. |
| Product | status, isDeactivated, isHidden, isVisible, deletedAt | Estado comercial, bloqueo, moderación, visibilidad y borrado independientes. |
| Community | isActive, isPrivate, deletedAt | Actividad, privacidad y soft delete independientes. |
| Report | status | pending/resolved/dismissed. |
| Seller | sellerRequestStatus, isVerified | Estado de solicitud y verificación. |

Aceptar null en communityId, community, excerpt, resolvedAt, resolvedByUser, resolutionAction, resolutionNote y deletedAt.

Defaults de paginación:

- reportes comunitarios: page 1, limit 20, máximo 100;
- reportes globales: page 1, limit 20, máximo 100;
- moderation log: page 1, limit 20, máximo 100;
- comunidades administrativas: page 1, limit 10, máximo 100.

## Flujos recomendados

1. Reportar post/reply/product: POST /reports; confirmar 201 y manejar 409.
2. Panel comunitario: GET /communities/:id/reports; usar counts, excerpt y contentUnavailable.
3. Resolver contenido: ruta comunitaria de resolve; refrescar porque pueden cambiar varios reports.
4. Revisar community report: hacerlo desde GET /reports como SUPERADMIN; ofrecer solo nota y dismiss.
5. Panel SUPERADMIN: GET /reports, GET /moderation-log y GET /users/stats.
6. Acciones sobre community: usar endpoints de community, no hideContent.

## Cosas que el frontend no debe asumir

- Resolver un report de community no desactiva ni elimina la community.
- Una community puede existir sin owner.
- Soft delete no es hard delete.
- Restaurar un seller no reactiva sus productos.
- Activar un usuario no restaura contenido oculto por otras razones.
- isDeactivated no es igual a status inactive.
- Un report puede existir aunque su target histórico no esté disponible.
- communityId puede ser null.
- warnAuthor no aplica a communities.
- No mostrar hideContent para itemType community.
- Reports globales y comunitarios tienen permisos distintos. Los Community Reports son exclusivos del panel global de SUPERADMIN.
- GET /users no declara paginación en su DTO actual.
- ReportItemType usa enum PostgreSQL y se sincroniza con synchronize true; no hay migration.

## Ejemplos curl

~~~bash
curl -X POST http://localhost:3000/reports \\
  -H "Authorization: Bearer <access_token>" \\
  -H "Content-Type: application/json" \\
  -d '{"itemType":"community","itemId":2,"reason":"spam","description":"Revisión necesaria"}'
~~~

~~~bash
curl "http://localhost:3000/communities/2/reports?page=1&limit=20&status=pending" \\
  -H "Authorization: Bearer <access_token>"
~~~

~~~bash
curl -X PATCH http://localhost:3000/reports/10/resolve \\
  -H "Authorization: Bearer <superadmin_token>" \\
  -H "Content-Type: application/json" \\
  -d '{"hideContent":false,"warnAuthor":false,"note":"Revisión administrativa"}'
~~~

## Referencia compacta

| Método | Endpoint | Permiso | Uso |
|---|---|---|---|
| POST | /reports | JWT | Crear reportes. |
| GET | /communities/:id/reports | moderator/owner | Reportes comunitarios. |
| GET | /communities/:id/reports/:reportId | moderator/owner | Detalle. |
| PATCH | /communities/:id/reports/:reportId/resolve | moderator/owner | Resolver. |
| PATCH | /communities/:id/reports/:reportId/dismiss | moderator/owner | Descartar. |
| GET | /reports | SUPERADMIN | Reportes globales. |
| PATCH | /reports/:id/resolve | SUPERADMIN | Resolver globalmente. |
| PATCH | /reports/:id/dismiss | SUPERADMIN | Descartar globalmente. |
| GET | /communities/:id/moderation/stats | moderator/owner | Estadísticas. |
| PATCH | /communities/:id/moderation/:itemType/:itemId/restore | moderator/owner | Restaurar contenido. |
| GET | /moderation-log | SUPERADMIN | Auditoría. |
| GET/PATCH/DELETE | /users/... | Según ruta | Usuarios. |
| PATCH | /users/:id/seller-status | SUPERADMIN | Seller. |
| PATCH/DELETE | /products/:id/... | Según ruta | Productos. |
| GET | /communities/all | SUPERADMIN | Comunidades administrativas. |
| POST | /communities | JWT | Crear community. |
| PATCH/DELETE | /communities/:id/... | Según ruta | Administración comunitaria. |
| GET | /users/stats | SUPERADMIN | Resumen global. |

## Validación

La documentación se basó en controllers, DTOs, enums, entities, services, guards y tests actuales. No modifica código productivo, no crea migrations, no modifica frontend y no realiza commit ni push.

