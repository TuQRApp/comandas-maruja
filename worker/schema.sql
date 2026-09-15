-- Esquema D1 para el sistema de comandas de empanadas
-- Sabores fijos, orden de impresión: Pino siempre primero.

CREATE TABLE IF NOT EXISTS pedidos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  correlativo   INTEGER NOT NULL,
  cliente       TEXT,                       -- nombre del cliente (opcional)
  comentario    TEXT,                       -- comentarios del pedido (opcional)
  fecha         TEXT NOT NULL,              -- 'YYYY-MM-DD' (día local Chile)
  hora          TEXT NOT NULL,              -- 'HH:MM:SS' hora local de creación
  creado_en     TEXT NOT NULL,              -- ISO 8601 UTC
  estado        TEXT NOT NULL DEFAULT 'pendiente',
                -- pendiente | impreso | error_impresion | listo
  confirmado_en TEXT,
  UNIQUE (fecha, correlativo)
);

CREATE TABLE IF NOT EXISTS items_pedido (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id           INTEGER NOT NULL REFERENCES pedidos(id),
  sabor               TEXT NOT NULL,
  cantidad_pedida     INTEGER NOT NULL,
  cantidad_entregada  INTEGER,              -- NULL hasta que Cocina confirma
  orden               INTEGER NOT NULL,     -- posición de impresión (0 = Pino)
  caliente            INTEGER NOT NULL DEFAULT 0  -- 1 = marcado "caliente" en Ventas
);

CREATE TABLE IF NOT EXISTS print_jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pedido_id     INTEGER NOT NULL REFERENCES pedidos(id),
  estado        TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | impreso | error
  intentos      INTEGER NOT NULL DEFAULT 0,
  error_msg     TEXT,
  creado_en     TEXT NOT NULL,
  actualizado_en TEXT
);

CREATE TABLE IF NOT EXISTS inventario (
  sabor          TEXT PRIMARY KEY,
  stock          INTEGER NOT NULL DEFAULT 0,
  actualizado_en TEXT
);

CREATE TABLE IF NOT EXISTS movimientos_inventario (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sabor      TEXT NOT NULL,
  delta      INTEGER NOT NULL,   -- negativo = descuento, positivo = reposición
  motivo     TEXT NOT NULL,      -- 'confirmacion_cocina' | 'ajuste_manual'
  pedido_id  INTEGER,
  creado_en  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pedidos_fecha ON pedidos(fecha);
CREATE INDEX IF NOT EXISTS idx_items_pedido ON items_pedido(pedido_id);
CREATE INDEX IF NOT EXISTS idx_print_jobs_estado ON print_jobs(estado);

-- Sabores iniciales en inventario (stock en 0 por defecto, se ajusta a mano)
INSERT OR IGNORE INTO inventario (sabor, stock, actualizado_en) VALUES
  ('Pino', 0, datetime('now')),
  ('Mechada', 0, datetime('now')),
  ('Champiñón', 0, datetime('now')),
  ('Queso', 0, datetime('now')),
  ('Camarón', 0, datetime('now')),
  ('Napolitana', 0, datetime('now')),
  ('Choclo Queso', 0, datetime('now'));
