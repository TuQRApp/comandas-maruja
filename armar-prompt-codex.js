// armar-prompt-codex.js
//
// Genera prompt-codex-full.txt: las instrucciones de revisión + el código
// completo de los archivos clave, todo en un solo archivo de texto.
// Esto evita que Codex tenga que leer archivos por su cuenta (lo cual falla
// en el sandbox de Windows) -- en vez de eso, le damos todo el contenido
// directamente como texto.
//
// USO: node armar-prompt-codex.js

const fs = require('fs');
const path = require('path');

const RAIZ = __dirname;

const ARCHIVOS = [
  'worker/wrangler.toml',
  'worker/schema.sql',
  'worker/migrations/0002_agregar_cliente.sql',
  'worker/migrations/0003_agregar_caliente_comentario.sql',
  'worker/src/index.js',
  'worker/src/correlativo-do.js',
  'pages/shared/api.js',
  'pages/shared/estilos.css',
  'pages/ventas/index.html',
  'pages/cocina/index.html',
  'pages/ventas/sw.js',
  'pages/cocina/sw.js',
  'bridge/print-server.js',
  'bridge/config.example.json',
  '.github/workflows/deploy.yml',
];

const INSTRUCCIONES =
  'Eres un revisor de código senior, muy exigente y directo. Te voy a pasar, dentro de este mismo mensaje, ' +
  'el código completo de un sistema de comandas (pedidos) para un negocio de empanadas: un backend en ' +
  'Cloudflare Workers (Hono) + D1 + Durable Object, dos PWAs (Ventas y Cocina) en HTML/JS plano, y un ' +
  '"bridge" en Node.js que imprime en una impresora térmica ESC/POS por USB, además de un workflow de GitHub Actions.\n\n' +
  'Este código acaba de recibir cambios recientes (primero te paso el "git diff" con lo que cambió sin ' +
  'commitear, y después cada archivo completo con todo su contexto). Los cambios recientes son, en resumen:\n' +
  '  1) La confirmación de un pedido en Cocina ahora es idempotente (UPDATE ... WHERE estado NOT IN (\'listo\',\'confirmando\') como reclamo atómico) para evitar doble descuento de inventario.\n' +
  '  2) El bridge ahora sanea el texto antes de imprimir: quita caracteres de control Y quita tildes/ñ (ej. "Champiñón" -> "Champinon"), porque no se puede garantizar que el codepage de la impresora física los muestre bien.\n' +
  '  3) Cada Service Worker (Ventas/Cocina) ya no borra la caché de la otra app al activarse.\n' +
  '  4) Funcionalidad nueva: checkbox "Caliente" por sabor en Ventas, se quitó la estrella junto a "Pino", y un campo de comentarios que viaja con el pedido, se guarda en la base y se imprime en el ticket.\n\n' +
  'No tienes que leer ningún archivo del disco: todo el código que necesitas ya está pegado más abajo, ' +
  'primero el diff y luego cada archivo bajo su encabezado "===== ARCHIVO: ... =====". No ejecutes comandos, ' +
  'no modifiques nada, no uses herramientas de archivo. Solo analiza el texto y responde.\n\n' +
  'Revisa ESPECÍFICAMENTE si esos 4 cambios están bien implementados (mira el diff con cuidado) y también repasa ' +
  'el resto del código en busca de otros problemas.\n\n' +
  'Responde en español. Estructura tu respuesta así:\n' +
  '1. Bugs y errores concretos (archivo + línea o fragmento exacto), primero los de los 4 cambios recientes, después el resto.\n' +
  '2. Problemas de concurrencia / condiciones de carrera (ventas simultáneas, reintentos de impresión, ' +
  'el Durable Object del correlativo, inventario negativo).\n' +
  '3. Seguridad (el token de autenticación, validación de datos de entrada, XSS, inyección de comandos ' +
  'ESC/POS vía el nombre del cliente o el comentario).\n' +
  '4. Confiabilidad del pipeline de impresión (impresora desconectada, bridge caído, jobs duplicados, orden de sabores, el saneo de acentos/control).\n' +
  '5. Problemas de las PWAs (service worker, caché, localStorage, pantallas en blanco o desactualizadas).\n' +
  '6. Otros riesgos o mejoras, priorizados por severidad (Crítico / Alto / Medio / Bajo).\n\n' +
  'Sé específico y práctico. Si algo te parece correcto, no hace falta que lo menciones. No reescribas el código.';

function armarDiff() {
  const { execSync } = require('child_process');
  try {
    const diff = execSync('git diff -- . && git status --porcelain', { cwd: RAIZ, maxBuffer: 1024 * 1024 * 20 }).toString();
    return diff || '(sin cambios detectados por git diff)';
  } catch (e) {
    return '(no se pudo obtener git diff: ' + e.message + ')';
  }
}

function armarContenido() {
  let bloque = '';
  for (const rel of ARCHIVOS) {
    const ruta = path.join(RAIZ, rel);
    if (!fs.existsSync(ruta)) {
      bloque += `\n\n===== ARCHIVO FALTANTE: ${rel} (no encontrado, se omite) =====\n`;
      continue;
    }
    const contenido = fs.readFileSync(ruta, 'utf8');
    bloque += `\n\n===== ARCHIVO: ${rel} =====\n${contenido}`;
  }
  return bloque;
}

const diffTexto = '\n\n===== GIT DIFF (cambios recientes sin commitear) =====\n' + armarDiff();
const salida = INSTRUCCIONES + '\n' + diffTexto + '\n\n===== ARCHIVOS COMPLETOS (con contexto) =====\n' + armarContenido();
const rutaSalida = path.join(RAIZ, 'prompt-codex-full.txt');
fs.writeFileSync(rutaSalida, salida, 'utf8');
console.log('Listo: ' + rutaSalida + ' (' + salida.length + ' caracteres)');
