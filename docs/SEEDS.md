# Seeds de datos de prueba

En `scripts/` hay tres seeds para llenar la base local con datos realistas (usuarios, comunidades, posts, hilos y productos con fotos). **No se ejecutan solos**: córrelos a mano solo si los necesitas, por ejemplo para probar el frontend o hacer una demo.

Las imágenes que usan están en `scripts/seed-images/`.

## Requisitos

- `.env` configurado (base de datos, `JWT_SECRET` y Cloudinary).
- Para los dos seeds nuevos, el backend corriendo (`npm run start:dev`), porque crean los productos, posts, respuestas y votos **a través de la API**. Así pasan por las mismas validaciones y la subida a Cloudinary que usa el frontend.
- Se corren desde la raíz del repo. Si el backend no está en `http://localhost:3000`, usa la variable `API_URL`.

## 1. `seed-forum-test-data.js`: feeds de foros

Usuarios `seed_*`, comunidades `seed-*`, posts, votos, respuestas y favoritos para probar Home y Explore. Escribe directo en la base, así que no necesita el backend corriendo.

```bash
node scripts/seed-forum-test-data.js           # limpia y siembra
node scripts/seed-forum-test-data.js --clean   # solo borra
```

Login: cualquier `seed_*` con contraseña `Test1234`.

## 2. `seed-community-users.js`: comunidades MLP Latam y Minecraft

- **11 usuarios**: 6 en *My Little Pony Latam* y 5 en *Minecraft Crafters CR*. `derpymuffins` está en las dos.
- **11 posts con imágenes** y **64 respuestas en hilos** (respuestas a respuestas), con votos y favoritos. Las fechas quedan repartidas en los últimos días.
- Crea la comunidad *Minecraft Crafters CR* (con ícono y banner) si no existe ninguna de Minecraft.
- **2 vendedores** (`creeperqueen` y `blockbuilder_cr`) con **5 productos** de Minecraft en CRC.
- Crea los tags `Minecraft`, `Fan Art` y `Videojuegos` si no existen.

**Requiere** que exista la comunidad `mylittleponylatam` (se busca por slug o por nombre).

```bash
node scripts/seed-community-users.js          # limpia lo anterior y siembra
node scripts/seed-community-users.js --clean  # solo borra lo sembrado
```

Login: cualquiera de esos usuarios (por ejemplo `lunadreamer` o `creeperqueen`) con contraseña `Test1234`.

Todo lo sembrado se identifica por el email `@seed.mynted.test`. `--clean` borra esos usuarios y, en cascada, sus perfiles, posts, respuestas, votos y productos. También borra sus datos de pago y la comunidad de Minecraft si la creó el seed.

## 3. `seed-twilightbuns-products.js`: tienda de twilightbuns

Publica **11 productos** de My Little Pony y Equestria Girls para el usuario `twilightbuns`, con fotos, descripciones y precios en CRC o USD según la moneda del usuario.

- **Si `twilightbuns` no existe**, el seed lo crea como vendedor aprobado (`twilightbuns@mynted.test` / `Test1234`, moneda CRC) y lo une a *My Little Pony Latam* si esa comunidad existe.
- **Si ya existe**, tiene que ser vendedor aprobado y tener moneda configurada. El script no modifica cuentas existentes y, si falta algo, dice qué es.
- Si `twilightbuns` es miembro de una comunidad de ponis, publica ahí. Si no, publica sin comunidad (también se puede forzar con `--no-community`).
- Es idempotente: no duplica productos que ya tienen el mismo título.

```bash
node scripts/seed-twilightbuns-products.js            # publica lo que falte
node scripts/seed-twilightbuns-products.js --clean    # borra (soft delete) sus productos sembrados
```

## Orden recomendado

1. `seed-community-users.js`, para que existan los usuarios y las comunidades.
2. `seed-twilightbuns-products.js`, para que twilightbuns quede dentro de MLP Latam.

`seed-forum-test-data.js` es independiente y se puede correr en cualquier momento.

> ⚠️ Son solo para desarrollo local. No se deben correr contra una base de producción.
