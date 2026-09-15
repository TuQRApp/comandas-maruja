// Módulo compartido entre las PWAs de Ventas y Cocina.
// Guarda la URL del Worker y el token de acceso en localStorage. Si un
// dispositivo no tiene nada guardado, se usan estos valores por defecto —
// así un celular nuevo funciona apenas se abre, sin tener que configurar
// nada a mano. Si en algún momento cambian el Worker o el token, basta con
// actualizar estas dos constantes y volver a publicar las PWAs.
const DEFAULT_API_URL = 'https://comandas-empanadas-api.nestragues.workers.dev';
const DEFAULT_API_TOKEN = 'maruja1234';

const LS_URL = 'comandas_api_url';
const LS_TOKEN = 'comandas_api_token';

export const SABORES = [
  'Pino',
  'Mechada',
  'Champiñón',
  'Queso',
  'Camarón',
  'Napolitana',
  'Choclo Queso',
];

export function getConfig() {
  return {
    url: localStorage.getItem(LS_URL) || DEFAULT_API_URL,
    token: localStorage.getItem(LS_TOKEN) || DEFAULT_API_TOKEN,
  };
}

export function setConfig(url, token) {
  localStorage.setItem(LS_URL, url.trim().replace(/\/+$/, ''));
  localStorage.setItem(LS_TOKEN, token.trim());
}

export function tieneConfig() {
  return !!getConfig().url;
}

async function llamar(path, opts = {}) {
  const { url, token } = getConfig();
  if (!url) throw new Error('Falta configurar la URL de la API');

  const resp = await fetch(url + path, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-api-token': token } : {}),
      ...(opts.headers || {}),
    },
  });

  let data = null;
  try {
    data = await resp.json();
  } catch (_) {
    /* respuesta sin cuerpo JSON */
  }

  if (!resp.ok) {
    throw new Error((data && data.error) || `Error ${resp.status}`);
  }
  return data;
}

export const api = {
  health: () => llamar('/api/health'),

  crearPedido: (items, cliente) =>
    llamar('/api/pedidos', { method: 'POST', body: JSON.stringify({ items, cliente }) }),

  listarPedidos: (fecha) => llamar(`/api/pedidos${fecha ? `?fecha=${fecha}` : ''}`),

  obtenerPedido: (id) => llamar(`/api/pedidos/${id}`),

  confirmarPedido: (id, items) =>
    llamar(`/api/pedidos/${id}/confirmar`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),

  inventario: () => llamar('/api/inventario'),

  ajustarInventario: (sabor, cambios) =>
    llamar('/api/inventario/ajustar', {
      method: 'POST',
      body: JSON.stringify({ sabor, ...cambios }),
    }),
};

export function escapeHtml(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

export function fechaHoyLocal() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'America/Santiago' }).split(' ')[0];
}
