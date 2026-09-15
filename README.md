# Sistema de Comandas — Empanadas

PWA de comandas para ventas y cocina, con impresión térmica automática en la
**UTEK UT-PRT230UE** vía un Bridge USB. Arquitectura validada en terreno:

```
PWA Ventas/Cocina (celular, cualquier red)
        │  HTTPS
        ▼
Cloudflare Worker + D1  (fuente de verdad: pedidos, cola de impresión, inventario)
        ▲  HTTPS (polling)
        │
Bridge Node.js (PC/mini PC)
        │  USB
        ▼
Impresora UTEK UT-PRT230UE
```

Ver `bridge/README.md` para el detalle de la impresora, y el documento de
arquitectura ya publicado para el contexto completo de por qué se llegó a
este diseño.

## Estructura del repo

```
worker/    API (Cloudflare Worker + D1 + Durable Object), en Hono
pages/     Las dos PWAs (ventas/ y cocina/) + un módulo compartido
bridge/    El proceso Node.js que imprime por USB
```

## 0. Prerrequisitos

- Cuenta de GitHub (ya la tienes).
- Cuenta de Cloudflare (ya la tienes).
- Node.js 18+ instalado en el PC donde vas a trabajar/desplegar.
- El Bridge (impresora + Zadig + Node) ya validado como hicimos hoy.

Todo lo de abajo lo corres tú desde tu computador, porque requiere que
inicies sesión con tus propias cuentas — yo no puedo autenticarme por ti.

## 1. Subir el proyecto a GitHub

```bash
cd comandas-empanadas
git init
git add .
git commit -m "Sistema de comandas: worker + PWAs + bridge"
```

Crea un repo vacío en https://github.com/new (por ejemplo
`comandas-empanadas`, puede ser privado), y luego:

```bash
git remote add origin https://github.com/<tu-usuario>/comandas-empanadas.git
git branch -M main
git push -u origin main
```

## 2. Configurar Cloudflare (Worker + D1)

Instala Wrangler y autentícate (abre el navegador para loguearte con tu
cuenta de Cloudflare):

```bash
cd worker
npm install
npx wrangler login
```

Crea la base de datos D1:

```bash
npx wrangler d1 create comandas-empanadas
```

Copia el `database_id` que te devuelve y pégalo en `worker/wrangler.toml`
donde dice `PEGAR_AQUI_EL_DATABASE_ID`.

Aplica el esquema:

```bash
npm run db:migrate:remote
```

Configura el token secreto que usarán las PWAs y el Bridge para
autenticarse (invéntate una clave larga y guárdala, la vas a necesitar
después):

```bash
npx wrangler secret put API_TOKEN
```

Despliega el Worker:

```bash
npm run deploy
```

Wrangler te va a mostrar la URL final, algo como:
`https://comandas-empanadas-api.<tu-cuenta>.workers.dev` — **guárdala**,
la necesitas en el paso 4.

## 3. Publicar las PWAs en Cloudflare Pages

Desde la raíz del repo:

```bash
npx wrangler pages deploy pages --project-name=comandas-empanadas
```

Esto te da una URL pública, por ejemplo
`https://comandas-empanadas.pages.dev`, con:

- `/` → pantalla para elegir Ventas o Cocina
- `/ventas/` → la PWA de Ventas (instalable)
- `/cocina/` → la PWA de Cocina (instalable)

## 4. Primer uso — configurar cada dispositivo

En el celular/tablet de Ventas, abre `https://<tu-pages>.pages.dev/ventas/`.
La primera vez pedirá:

- **URL de la API**: la del Worker (paso 2).
- **Token de acceso**: el que configuraste con `wrangler secret put API_TOKEN`.

Luego puedes "Agregar a pantalla de inicio" para que quede como app
instalada. Repite lo mismo en el dispositivo de Cocina con `/cocina/`.

## 5. Dejar el Bridge corriendo

Sigue `bridge/README.md` en el PC/mini PC conectado por USB a la
impresora. Usa la misma URL del Worker y el mismo token.

## 6. (Opcional) Despliegue automático con GitHub Actions

Ya incluí `.github/workflows/deploy.yml`: cada `git push` a `main`
despliega el Worker y las Pages automáticamente. Para que funcione, en
GitHub ve a **Settings → Secrets and variables → Actions** del repo y
agrega:

- `CLOUDFLARE_API_TOKEN`: créalo en el dashboard de Cloudflare
  (**My Profile → API Tokens → Create Token**, plantilla "Edit Cloudflare
  Workers" — o dale permisos de Workers + Pages + D1).
- `CLOUDFLARE_ACCOUNT_ID`: lo ves en el dashboard de Cloudflare, en la
  barra lateral de cualquier dominio/cuenta.

Sin esto configurado, simplemente sigue desplegando manualmente con los
comandos de los pasos 2 y 3 cada vez que cambies algo.

## Cómo funciona el flujo completo

1. Ventas ingresa cantidades por sabor (Pino siempre imprime primero) y
   presiona **IMPRIMIR COMANDA**.
2. El Worker asigna un correlativo atómico del día (vía Durable Object),
   guarda el pedido en D1 y crea un "print job" pendiente.
3. El Bridge (Node.js, conectado por USB a la impresora) consulta el
   Worker cada 1.5s, imprime el ticket con ESC/POS y confirma el
   resultado al Worker.
4. Cocina ve el pedido por su número de comanda, prepara, y confirma las
   cantidades realmente entregadas (puede ajustar hacia abajo si faltó
   stock de algún sabor). Al confirmar, se descuenta inventario.
5. Ventas ve el pedido como **Listo** en su lista de pedidos del día.
6. Ambas interfaces tienen una pestaña de **Inventario** para ajustar el
   stock manualmente (reposición, conteo físico, etc.).

## Supuestos tomados (ajustables)

- El inventario se descuenta cuando **Cocina confirma la entrega** (no al
  tomar el pedido), porque es el momento en que se sabe la cantidad real
  usada.
- Un token compartido simple protege la API (sin login por usuario) —
  suficiente para un local pequeño con pocos dispositivos de confianza.
- Un solo Bridge/impresora. Si se necesita una segunda impresora o
  estación, se agrega otro Bridge apuntando al mismo Worker.
