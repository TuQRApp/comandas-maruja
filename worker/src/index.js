import { Hono } from 'hono';
import { cors } from 'hono/cors';

export { Correlativo } from './correlativo-do.js';

// Orden fijo de sabores. La posición en este arreglo define el orden de
// impresión en el ticket (Pino siempre primero porque es el primero de la lista).
export const SABORES = [
  'Pino',
  'Mechada',
  'Champiñón',
  'Queso',
  'Camarón',
  'Napolitana',
  'Choclo Queso',
];

const app = new Hono();

app.use('/api/*', cors());

// --- Autenticación simple por token compartido -----------------------------
// El token se guarda como secret en el Worker (API_TOKEN) y cada PWA/Bridge
// lo manda en el header x-api-token. Si no se configura API_TOKEN (por
// ejemplo en `wrangler dev` local) no se exige, para facilitar pruebas.
app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/health') return next();
  const expected = c.env.API_TOKEN;
  if (!expected) return next();
  const got = c.req.header('x-api-token');
  if (got !== expected) {
    return c.json({ error: 'Token inválido o ausente' }, 401);
  }
  return next();
});

function fechaHoraLocal() {
  // America/Santiago. El truco de locale 'sv-SE' produce 'YYYY-MM-DD HH:MM:SS'.
  const partes = new Date()
    .toLocaleString('sv-SE', { timeZone: 'America/Santiago' })
    .split(' ');
  return { fecha: partes[0], hora: partes[1] };
}

app.get('/api/health', (c) => c.json({ ok: true, hora_servidor: new Date().toISOString() }));

// --- Pedidos -----------------------------------------------------------

app.post('/api/pedidos', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !Array.isArray(body.items) || body.items.length === 0) {
    return c.json({ error: 'Se requiere items: [{ sabor, cantidad }]' }, 400);
  }

  const items = body.items
    .filter((it) => it && SABORES.includes(it.sabor) && Number(it.cantidad) > 0)
    .map((it) => ({ sabor: it.sabor, cantidad: Math.floor(Number(it.cantidad)) }));

  if (items.length === 0) {
    return c.json({ error: 'No hay cantidades válidas mayores a 0' }, 400);
  }

  const cliente = typeof body.cliente === 'string' ? body.cliente.trim().slice(0, 80) : '';

  const { fecha, hora } = fechaHoraLocal();
  const creadoEn = new Date().toISOString();

  // Correlativo atómico vía Durable Object (una sola instancia global por fecha)
  const doId = c.env.CORRELATIVO.idFromName('global');
  const stub = c.env.CORRELATIVO.get(doId);
  const resp = await stub.fetch(`https://do/siguiente?fecha=${fecha}`);
  if (!resp.ok) return c.json({ error: 'No se pudo asignar correlativo' }, 500);
  const { correlativo } = await resp.json();

  const db = c.env.DB;
  const insertPedido = await db
    .prepare(
      `INSERT INTO pedidos (correlativo, cliente, fecha, hora, creado_en, estado) VALUES (?, ?, ?, ?, ?, 'pendiente')`
    )
    .bind(correlativo, cliente || null, fecha, hora, creadoEn)
    .run();

  const pedidoId = insertPedido.meta.last_row_id;

  const stmts = items.map((it) =>
    db
      .prepare(
        `INSERT INTO items_pedido (pedido_id, sabor, cantidad_pedida, orden) VALUES (?, ?, ?, ?)`
      )
      .bind(pedidoId, it.sabor, it.cantidad, SABORES.indexOf(it.sabor))
  );
  stmts.push(
    db
      .prepare(`INSERT INTO print_jobs (pedido_id, estado, creado_en) VALUES (?, 'pendiente', ?)`)
      .bind(pedidoId, creadoEn)
  );
  await db.batch(stmts);

  const pedido = await cargarPedido(db, pedidoId);
  return c.json(pedido, 201);
});

app.get('/api/pedidos', async (c) => {
  const fecha = c.req.query('fecha') || fechaHoraLocal().fecha;
  const db = c.env.DB;
  const { results } = await db
    .prepare(`SELECT * FROM pedidos WHERE fecha = ? ORDER BY correlativo DESC`)
    .bind(fecha)
    .all();

  const pedidos = [];
  for (const p of results) {
    pedidos.push(await cargarPedido(db, p.id, p));
  }
  return c.json({ fecha, pedidos });
});

app.get('/api/pedidos/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const pedido = await cargarPedido(c.env.DB, id);
  if (!pedido) return c.json({ error: 'No encontrado' }, 404);
  return c.json(pedido);
});

app.post('/api/pedidos/:id/confirmar', async (c) => {
  const id = Number(c.req.param('id'));
  const db = c.env.DB;
  const body = await c.req.json().catch(() => null);
  if (!body || !Array.isArray(body.items)) {
    return c.json({ error: 'Se requiere items: [{ sabor, cantidad_entregada }]' }, 400);
  }

  const pedido = await cargarPedido(db, id);
  if (!pedido) return c.json({ error: 'No encontrado' }, 404);

  const ahora = new Date().toISOString();
  const stmts = [];

  for (const item of pedido.items) {
    const enviado = body.items.find((it) => it.sabor === item.sabor);
    const entregada = enviado ? Math.max(0, Math.floor(Number(enviado.cantidad_entregada))) : item.cantidad_pedida;

    stmts.push(
      db
        .prepare(`UPDATE items_pedido SET cantidad_entregada = ? WHERE id = ?`)
        .bind(entregada, item.id)
    );

    if (entregada > 0) {
      stmts.push(
        db
          .prepare(
            `UPDATE inventario SET stock = stock - ?, actualizado_en = ? WHERE sabor = ?`
          )
          .bind(entregada, ahora, item.sabor)
      );
      stmts.push(
        db
          .prepare(
            `INSERT INTO movimientos_inventario (sabor, delta, motivo, pedido_id, creado_en) VALUES (?, ?, 'confirmacion_cocina', ?, ?)`
          )
          .bind(item.sabor, -entregada, id, ahora)
      );
    }
  }

  stmts.push(
    db
      .prepare(`UPDATE pedidos SET estado = 'listo', confirmado_en = ? WHERE id = ?`)
      .bind(ahora, id)
  );

  await db.batch(stmts);
  const actualizado = await cargarPedido(db, id);
  return c.json(actualizado);
});

async function cargarPedido(db, id, fila) {
  const p =
    fila || (await db.prepare(`SELECT * FROM pedidos WHERE id = ?`).bind(id).first());
  if (!p) return null;
  const { results: items } = await db
    .prepare(`SELECT * FROM items_pedido WHERE pedido_id = ? ORDER BY orden ASC`)
    .bind(p.id)
    .all();
  return { ...p, items };
}

// --- Cola de impresión (consumida por el Bridge) ------------------------

app.get('/api/print-jobs/pendientes', async (c) => {
  const db = c.env.DB;
  const { results: jobs } = await db
    .prepare(
      `SELECT pj.*, p.correlativo, p.cliente, p.fecha, p.hora
       FROM print_jobs pj JOIN pedidos p ON p.id = pj.pedido_id
       WHERE pj.estado = 'pendiente'
       ORDER BY pj.id ASC LIMIT 10`
    )
    .all();

  const salida = [];
  for (const job of jobs) {
    const { results: items } = await db
      .prepare(`SELECT sabor, cantidad_pedida FROM items_pedido WHERE pedido_id = ? ORDER BY orden ASC`)
      .bind(job.pedido_id)
      .all();
    salida.push({
      job_id: job.id,
      pedido_id: job.pedido_id,
      correlativo: job.correlativo,
      cliente: job.cliente || '',
      fecha: job.fecha,
      hora: job.hora,
      items: items.map((it) => ({ nombre: it.sabor, cantidad: it.cantidad_pedida })),
    });
  }
  return c.json({ jobs: salida });
});

app.post('/api/print-jobs/:id/estado', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => null);
  if (!body || !['impreso', 'error'].includes(body.estado)) {
    return c.json({ error: "estado debe ser 'impreso' o 'error'" }, 400);
  }
  const db = c.env.DB;
  const ahora = new Date().toISOString();

  const job = await db.prepare(`SELECT * FROM print_jobs WHERE id = ?`).bind(id).first();
  if (!job) return c.json({ error: 'No encontrado' }, 404);

  await db
    .prepare(
      `UPDATE print_jobs SET estado = ?, error_msg = ?, intentos = intentos + 1, actualizado_en = ? WHERE id = ?`
    )
    .bind(body.estado, body.error_msg || null, ahora, id)
    .run();

  const estadoPedido = body.estado === 'impreso' ? 'impreso' : 'error_impresion';
  await db
    .prepare(`UPDATE pedidos SET estado = ? WHERE id = ?`)
    .bind(estadoPedido, job.pedido_id)
    .run();

  return c.json({ ok: true });
});

app.post('/api/print-jobs/:id/reintentar', async (c) => {
  const id = Number(c.req.param('id'));
  const db = c.env.DB;
  const job = await db.prepare(`SELECT * FROM print_jobs WHERE id = ?`).bind(id).first();
  if (!job) return c.json({ error: 'No encontrado' }, 404);
  await db.batch([
    db.prepare(`UPDATE print_jobs SET estado = 'pendiente', error_msg = NULL WHERE id = ?`).bind(id),
    db.prepare(`UPDATE pedidos SET estado = 'pendiente' WHERE id = ?`).bind(job.pedido_id),
  ]);
  return c.json({ ok: true });
});

// --- Inventario ----------------------------------------------------------

app.get('/api/inventario', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT * FROM inventario ORDER BY sabor`).all();
  return c.json({ inventario: results });
});

app.post('/api/inventario/ajustar', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !SABORES.includes(body.sabor)) {
    return c.json({ error: 'sabor inválido' }, 400);
  }
  const db = c.env.DB;
  const ahora = new Date().toISOString();

  if (typeof body.stock === 'number') {
    // Fijar stock absoluto (ej: conteo físico de la mañana)
    const actual = await db.prepare(`SELECT stock FROM inventario WHERE sabor = ?`).bind(body.sabor).first();
    const delta = Math.floor(body.stock) - (actual ? actual.stock : 0);
    await db.batch([
      db
        .prepare(`UPDATE inventario SET stock = ?, actualizado_en = ? WHERE sabor = ?`)
        .bind(Math.floor(body.stock), ahora, body.sabor),
      db
        .prepare(
          `INSERT INTO movimientos_inventario (sabor, delta, motivo, creado_en) VALUES (?, ?, 'ajuste_manual', ?)`
        )
        .bind(body.sabor, delta, ahora),
    ]);
  } else if (typeof body.delta === 'number') {
    await db.batch([
      db
        .prepare(`UPDATE inventario SET stock = stock + ?, actualizado_en = ? WHERE sabor = ?`)
        .bind(Math.floor(body.delta), ahora, body.sabor),
      db
        .prepare(
          `INSERT INTO movimientos_inventario (sabor, delta, motivo, creado_en) VALUES (?, ?, 'ajuste_manual', ?)`
        )
        .bind(body.sabor, Math.floor(body.delta), ahora),
    ]);
  } else {
    return c.json({ error: 'Se requiere stock (absoluto) o delta (relativo)' }, 400);
  }

  const actualizado = await db.prepare(`SELECT * FROM inventario WHERE sabor = ?`).bind(body.sabor).first();
  return c.json(actualizado);
});

export default app;
