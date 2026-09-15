// Durable Object: entrega números correlativos atómicos, uno por día.
// Al ser un Durable Object, Cloudflare garantiza que solo una instancia
// procesa peticiones para un mismo "id" a la vez, así que dos ventas
// que imprimen casi al mismo tiempo nunca reciben el mismo número.

export class Correlativo {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== '/siguiente') {
      return new Response('not found', { status: 404 });
    }

    const fecha = url.searchParams.get('fecha');
    if (!fecha) {
      return new Response('falta ?fecha=YYYY-MM-DD', { status: 400 });
    }

    // Todo el trabajo ocurre dentro de blockConcurrencyWhile para que
    // lecturas y escrituras sobre el storage sean atómicas.
    const siguiente = await this.state.blockConcurrencyWhile(async () => {
      const stored = (await this.state.storage.get('contador')) || {
        fecha: null,
        ultimo: 0,
      };

      let ultimo = stored.ultimo;
      if (stored.fecha !== fecha) {
        // Nuevo día: el contador reinicia en 1.
        ultimo = 0;
      }
      ultimo += 1;

      await this.state.storage.put('contador', { fecha, ultimo });
      return ultimo;
    });

    return new Response(JSON.stringify({ correlativo: siguiente }), {
      headers: { 'content-type': 'application/json' },
    });
  }
}
