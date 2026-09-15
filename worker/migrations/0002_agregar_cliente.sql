-- Agrega el campo "cliente" (nombre del cliente) a pedidos ya existentes.
-- schema.sql ya incluye esta columna para instalaciones nuevas; este archivo
-- es solo para bases de datos que ya estaban desplegadas antes de este cambio.
ALTER TABLE pedidos ADD COLUMN cliente TEXT;
