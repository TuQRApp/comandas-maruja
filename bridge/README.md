# Bridge de impresión (PC/mini PC + USB)

Este es el mismo mecanismo que se probó y validó en terreno: Node.js habla
directo con la impresora **UTEK UT-PRT230UE** por USB usando ESC/POS, y
consulta al Worker de Cloudflare para saber qué comandas hay pendientes de
imprimir. No necesita que el celular y la impresora estén en la misma red
— el celular habla con el Worker (internet) y el Bridge también habla con
el Worker (internet); nunca se comunican directo entre sí.

## 1. Preparar el USB con Zadig (una sola vez)

1. Conecta la impresora al PC por USB (además del cable de corriente).
2. Descarga [Zadig](https://zadig.akeo.ie/) y ábrelo como administrador.
3. Menú `Options -> List All Devices`.
4. Selecciona el dispositivo de la impresora (aparece como **Printer-80**,
   USB ID `1FC9:2016` en la unidad probada — si el tuyo tiene otro ID,
   anótalo, lo necesitas en el paso 3).
5. En el driver de reemplazo elige **WinUSB** y click en **Replace Driver**.
   Verás "Driver Installation: SUCCESS".

   ⚠️ Después de esto Windows ya no puede imprimir a esta impresora desde
   sus diálogos normales (Word, el panel de impresoras, etc.) — solo el
   Bridge (Node.js) puede hablarle por USB. Es el trade-off esperado.

## 2. Instalar dependencias

```bash
cd bridge
npm install
```

Si ves un error como `usb.findByIds is not a function`, es porque se
instaló una versión nueva de `usb` que cambió su API. Arréglalo con:

```bash
npm uninstall usb
npm install usb@1.9.2
```

(el `package.json` ya deja fijada esa versión, así que un `npm install`
limpio no debería necesitar este paso).

## 3. Configurar

```bash
cp config.example.json config.json
```

Edita `config.json`:

- `apiUrl`: la URL del Worker ya desplegado (`https://<nombre>.workers.dev`
  o tu dominio propio).
- `apiToken`: el mismo valor que configuraste en el Worker con
  `wrangler secret put API_TOKEN`.
- `usbVendorId` / `usbProductId`: el VID:PID que viste en Zadig (sin el
  prefijo `0x`, ej. `1FC9` y `2016`).
- `pollIntervalMs`: cada cuánto revisa si hay comandas nuevas (1500 ms
  funciona bien).

## 4. Probar

```bash
npm start
```

Deberías ver `Bridge activo. Consultando https://... cada 1500ms...`.
Envía una comanda de prueba desde la PWA de Ventas y en 1-2 segundos debería
salir el ticket impreso.

## 5. Dejarlo corriendo siempre (recomendado)

Este proceso debe quedar corriendo todo el día. Dos formas simples en
Windows:

**Opción A: pm2**
```bash
npm install -g pm2
pm2 start print-server.js --name comandas-bridge
pm2 save
pm2-startup install   # deja pm2 arrancando con Windows
```

**Opción B: Programador de tareas de Windows**
Crea una tarea que ejecute `node C:\ruta\a\bridge\print-server.js` al
iniciar sesión, con reintento si falla.

## Notas

- El Bridge imprime un ticket a la vez (nunca en paralelo) para no chocar
  contra el mismo puerto USB.
- Si la impresora se desconecta o se queda sin papel, el job queda marcado
  como `error` en el Worker; la comanda se puede reintentar (endpoint
  `POST /api/print-jobs/:id/reintentar`) una vez resuelto el problema.
- El PC del Bridge puede estar conectado por WiFi o cable — solo necesita
  salida a internet, no necesita estar en la misma red que los celulares.
