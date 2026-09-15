// Bridge de impresión: corre en el PC/mini PC conectado por USB a la
// impresora UTEK UT-PRT230UE. Hace polling al Worker de Cloudflare (la
// misma API que usan las PWAs de Ventas/Cocina) y cuando hay comandas
// pendientes las imprime vía ESC/POS por USB.
//
// Requisitos (ver bridge/README.md para el detalle paso a paso):
//   - Node.js instalado.
//   - Driver de la impresora reemplazado por WinUSB usando Zadig.
//   - npm install (instala escpos, escpos-usb y usb@1.9.2 — ver package.json).
//   - Copiar config.example.json a config.json y completar los datos.

const fs = require('fs');
const path = require('path');
const escpos = require('escpos');
escpos.USB = require('escpos-usb');

const CONFIG_PATH = path.join(__dirname, 'config.json');
if (!fs.existsSync(CONFIG_PATH)) {
  console.error('Falta config.json. Copia config.example.json a config.json y complétalo.');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const API_URL = config.apiUrl.replace(/\/+$/, '');
const API_TOKEN = config.apiToken || '';
const VID = parseInt(config.usbVendorId, 16);
const PID = parseInt(config.usbProductId, 16);
const POLL_MS = config.pollIntervalMs || 1500;

function headers() {
  return {
    'content-type': 'application/json',
    ...(API_TOKEN ? { 'x-api-token': API_TOKEN } : {}),
  };
}

async function obtenerPendientes() {
  const resp = await fetch(`${API_URL}/api/print-jobs/pendientes`, { headers: headers() });
  if (!resp.ok) throw new Error(`GET pendientes -> ${resp.status}`);
  const data = await resp.json();
  return data.jobs || [];
}

async function reportarEstado(jobId, estado, errorMsg) {
  const resp = await fetch(`${API_URL}/api/print-jobs/${jobId}/estado`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ estado, error_msg: errorMsg || undefined }),
  });
  if (!resp.ok) console.error(`No se pudo reportar estado del job ${jobId}: HTTP ${resp.status}`);
}

// Deja un texto seguro para mandarlo a la impresora:
//   1) Quita caracteres de control (ESC, etc.) para que nadie pueda meter
//      comandos ESC/POS escondidos en el nombre del cliente o el comentario
//      (cortar papel, resetear la impresora, etc.).
//   2) Quita tildes, "ñ" y cualquier otro caracter que no sea ASCII básico.
//      No tenemos forma de confirmar desde aquí que el codepage de la
//      impresora física muestre bien "Champiñón" o "Camarón" — si no lo
//      soporta, esos caracteres salen como simbolos raros en el ticket. Por
//      seguridad los reemplazamos siempre por su versión sin tilde
//      (Champinon, Camaron), que cualquier impresora ESC/POS imprime bien.
function limpiarParaImprimir(texto, maxLen) {
  const sinControl = String(texto || '').replace(/[\x00-\x1F\x7F]/g, '');
  const sinAcentos = sinControl
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita las tildes (é -> e, ñ -> n, etc.)
    .replace(/[^\x20-\x7E]/g, '');   // por si queda algún otro simbolo no ASCII
  return sinAcentos.trim().slice(0, maxLen || 80);
}

function imprimirTicket(job) {
  return new Promise((resolve, reject) => {
    let device;
    try {
      device = new escpos.USB(VID, PID);
    } catch (err) {
      return reject(new Error('Impresora no encontrada por USB: ' + err.message));
    }

    const printer = new escpos.Printer(device);
    device.open((err) => {
      if (err) return reject(new Error('No se pudo abrir la impresora: ' + err.message));

      try {
        printer
          .align('CT')
          .size(1, 1)
          .text(`COMANDA #${job.correlativo}`)
          .text(`${job.fecha}  ${job.hora}`);

        const clienteSeguro = limpiarParaImprimir(job.cliente, 80);
        if (clienteSeguro) {
          printer.text(`Cliente: ${clienteSeguro}`);
        }

        printer.text('--------------------------------').align('LT').size(1, 1);

        for (const item of job.items) {
          const nombreSeguro = limpiarParaImprimir(item.nombre, 40);
          const marca = item.caliente ? ' (CALIENTE)' : '';
          printer.text(`${item.cantidad} x ${nombreSeguro}${marca}`);
        }

        const comentarioSeguro = limpiarParaImprimir(job.comentario, 200);
        if (comentarioSeguro) {
          printer.text('--------------------------------');
          printer.text(`Comentario: ${comentarioSeguro}`);
        }

        printer.text(' ').text(' ').cut().close(() => resolve());
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function cicloDeImpresion() {
  let jobs;
  try {
    jobs = await obtenerPendientes();
  } catch (err) {
    console.error('No se pudo consultar el Worker:', err.message);
    return;
  }

  for (const job of jobs) {
    // Uno a la vez: nunca en paralelo, para no chocar en el acceso al USB.
    try {
      await imprimirTicket(job);
      await reportarEstado(job.job_id, 'impreso');
      console.log(`Comanda #${job.correlativo} impresa OK`);
    } catch (err) {
      console.error(`Error imprimiendo comanda #${job.correlativo}:`, err.message);
      await reportarEstado(job.job_id, 'error', err.message);
    }
  }
}

let corriendo = false;
setInterval(async () => {
  if (corriendo) return; // evita solapar ciclos si una impresión demora más que el intervalo
  corriendo = true;
  try {
    await cicloDeImpresion();
  } finally {
    corriendo = false;
  }
}, POLL_MS);

console.log(`Bridge activo. Consultando ${API_URL} cada ${POLL_MS}ms...`);
