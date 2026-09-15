// revisar-con-deepseek.js
//
// Envía los archivos clave del proyecto a la API de DeepSeek para pedirle
// una revisión de código independiente, y guarda la respuesta en
// review-deepseek.md.
//
// USO:
//   1) Crea una cuenta en https://platform.deepseek.com y genera una API key.
//   2) Guarda esa key (solo el texto de la key, nada más) en un archivo
//      llamado deepseek-key.txt en esta misma carpeta.
//   3) Corre:  node revisar-con-deepseek.js
//   4) Lee la consola o abre review-deepseek.md cuando termine.
//
// No modifica ningún archivo del proyecto. Solo lee y manda un reporte.

const fs = require('fs');
const path = require('path');

const RAIZ = __dirname;

// Archivos que se incluyen en la revisión (rutas relativas a la raíz del proyecto)
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

// Trae el diff de git (cambios recientes aún no commiteados) para que el
// revisor sepa exactamente qué se acaba de tocar, además de ver el archivo
// completo con contexto.
function armarDiff() {
  const { execSync } = require('child_process');
  try {
    const diff = execSync('git diff -- . && git status --porcelain', { cwd: RAIZ, maxBuffer: 1024 * 1024 * 20 }).toString();
    return diff || '(sin cambios detectados por git diff)';
  } catch (e) {
    return '(no se pudo obtener git diff: ' + e.message + ')';
  }
}

function leerKey() {
  const rutaKey = path.join(RAIZ, 'deepseek-key.txt');
  if (!fs.existsSync(rutaKey)) {
    console.error(
      '\nFalta el archivo deepseek-key.txt en:\n  ' + rutaKey +
      '\nCréalo y pega dentro SOLO tu API key de DeepSeek (sin comillas, sin espacios extra).\n'
    );
    process.exit(1);
  }
  return fs.readFileSync(rutaKey, 'utf8').trim();
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

async function main() {
  const apiKey = leerKey();
  const diff = armarDiff();
  const codigo = armarContenido();

  const systemPrompt =
    'Eres un revisor de código senior, muy exigente y directo. ' +
    'Te voy a pasar el código completo de un sistema de comandas (pedidos) para un negocio de empanadas: ' +
    'un backend en Cloudflare Workers (Hono) + D1 + Durable Object, dos PWAs (Ventas y Cocina) en HTML/JS plano, ' +
    'y un "bridge" en Node.js que imprime en una impresora térmica ESC/POS por USB, además de un workflow de GitHub Actions.\n\n' +
    'Este código acaba de recibir cambios recientes (te paso el "git diff" primero, y después cada archivo completo con ' +
    'todo su contexto). Los cambios recientes son, en resumen:\n' +
    '  1) La confirmación de un pedido en Cocina ahora es idempotente (usa un UPDATE ... WHERE estado NOT IN (\'listo\',\'confirmando\') como reclamo atómico) para evitar doble descuento de inventario.\n' +
    '  2) El bridge ahora sanea el texto antes de imprimir: quita caracteres de control Y quita tildes/ñ (los reemplaza, ej. "Champiñón" -> "Champinon"), porque no se puede garantizar que el codepage de la impresora física los muestre bien.\n' +
    '  3) Cada Service Worker (Ventas/Cocina) ya no borra la caché de la otra app al activarse (antes se borraba cualquier caché con nombre distinto al propio, y como caches.keys() lista TODAS las cachés del origen, una borraba la de la otra).\n' +
    '  4) Funcionalidad nueva: en Ventas, cada sabor tiene un checkbox "🔥 Caliente" (antes no existía); se quitó la estrella junto al nombre "Pino"; se agregó un campo de comentarios de texto libre que viaja con el pedido, se guarda en la base (columna nueva) y se imprime en el ticket.\n\n' +
    'Quiero que revises ESPECÍFICAMENTE si estos 4 cambios están bien implementados y no rompieron nada (mira el diff con cuidado), y que también repases el resto del código en busca de otros problemas que no se hayan visto antes. ' +
    'No es un resumen genérico, quiero una revisión de código real. ' +
    'Responde en español. Estructura tu respuesta así:\n' +
    '1. Bugs y errores concretos (con el archivo y la línea o fragmento exacto), separando primero los que veas en los 4 cambios recientes, y después el resto.\n' +
    '2. Problemas de concurrencia / condiciones de carrera (por ejemplo: dos ventas casi simultáneas, reintentos de impresión, el Durable Object del correlativo, inventario negativo).\n' +
    '3. Seguridad (el token de autenticación, validación de datos de entrada, XSS en los campos que se imprimen o se muestran en HTML, el nuevo campo de comentarios).\n' +
    '4. Confiabilidad del pipeline de impresión (qué pasa si la impresora se desconecta, si el bridge se cae, jobs duplicados, orden de los sabores, el saneo de acentos/control).\n' +
    '5. Problemas de las PWAs (service worker, caché, localStorage, que puedan dejar la app en blanco o desactualizada).\n' +
    '6. Otros riesgos o mejoras que consideres importantes, priorizados por severidad.\n' +
    'Sé específico y práctico. Si algo te parece correcto, no hace falta que lo menciones. No reescribas el código, solo da las observaciones.';

  const mensajeUsuario =
    '===== GIT DIFF (cambios recientes sin commitear) =====\n' + diff +
    '\n\n===== ARCHIVOS COMPLETOS (con contexto) =====\n' + codigo;

  console.log('Enviando código a DeepSeek para revisión... (puede tardar uno o dos minutos)');

  const resp = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      temperature: 0.2,
      max_tokens: 8000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: mensajeUsuario },
      ],
    }),
  });

  if (!resp.ok) {
    const texto = await resp.text();
    console.error(`\nError de la API de DeepSeek (status ${resp.status}):\n${texto}`);
    process.exit(1);
  }

  const data = await resp.json();
  const respuesta = data.choices?.[0]?.message?.content || '(sin contenido en la respuesta)';

  const rutaSalida = path.join(RAIZ, 'review-deepseek.md');
  fs.writeFileSync(rutaSalida, respuesta, 'utf8');

  console.log('\n================ REVISIÓN DE DEEPSEEK ================\n');
  console.log(respuesta);
  console.log('\n========================================================');
  console.log(`\nGuardado también en: ${rutaSalida}`);
}

main().catch((e) => {
  console.error('Error inesperado:', e);
  process.exit(1);
});
