# Panel de subrevendedores (Node.js + MongoDB)

Requiere Node 22.13 o superior y MongoDB (Atlas gratis sirve). Ejecuta `npm install` una vez.

## Puesta en marcha
1. `cp .env.example .env` y edita `SESSION_SECRET` (cadena larga aleatoria).
2. Pon `MONGODB_URI` en `.env` y crea el admin: `node --env-file=.env scripts/crear-admin.js TU_USUARIO TU_CLAVE`
3. Arranca: `node --env-file=.env server.js` y abre http://localhost:3000
4. Como admin: **Catálogo de Central One → Vender** (elige los productos), crea subrevendedores, ponles margen % y abónales saldo.
5. Esta versión usa MongoDB; los datos de versiones SQLite anteriores no se migran.

## Conectar con Central One
- Portal → Integración: crea una llave con permisos `orders:write`, `orders:read`, `catalog:read` y `balance:read`.
  NO marques `codes:read` (revela códigos de gift cards y este panel no los usa). Guárdala en `.env` como
  `PROVIDER_API_KEY` (se muestra una sola vez). `PROVIDER_MODE=real`. Al arrancar, el panel prueba la llave con `GET /ping`.
- **No hay modo sandbox**: cualquier pedido mueve saldo real. Haz la primera prueba con el producto más barato.
- Todo el contacto con la API está en `provider.js`.
- Webhooks (opcional; la URL debe ser https, puerto 443 u 8443, dominio público; no sigue redirecciones): en Integración → Webhooks pon `https://TU-DOMINIO/webhooks/central-one` y copia el secreto a
  `WEBHOOK_SECRET`. Se verifica la firma HMAC sobre el cuerpo crudo, se rechazan avisos de más de 5 min y se
  procesa cada `event_id` una sola vez. Los avisos solo aceleran lo que la consulta periódica ya hace.

## Cómo se calculan los precios
- El costo es el `reseller_price` del catálogo (4 decimales, guardado como entero ×10000; nunca floats).
- Precio al subrevendedor = costo + margen %, redondeado hacia ARRIBA al centavo.
- El catálogo se refresca cada 15 min y con avisos `product.price_changed` / `stock_changed`.
- Central One cobra lo que diga `total_sale_amount` al crear el pedido: el panel lo guarda como costo real y
  el admin ve el margen real de cada pedido. El saldo de Central One se lee de `GET /balance`.

## Flujo de un pedido
cobro interno → POST /orders (Idempotency-Key propia) → "En proceso" → GET /orders/{id} (cada 30 s los primeros
5 min y luego cada 5 min, como pide la documentación; los avisos lo adelantan) → "Completada" o "Fallida"
(reembolso automático, una sola vez).
- **Un pedido fallido puede entregarse después** (la documentación avisa que `order.failed` no siempre es definitivo).
  Por eso los pedidos fallidos se siguen vigilando 48 h: si Central One termina entregando, se le cobra de nuevo
  al subrevendedor; si no tiene saldo, queda "Verificando" y el admin pulsa "Sí llegó" tras abonarle.
- Los campos de destino salen del `target_schema` de cada producto (texto u opciones), nunca fijos.
- Rechazo claro (400/401/403/404, 409 insufficient_balance / insufficient_stock, 422) → reembolso inmediato.
  Resultado incierto (429, 5xx, timeout) → reintentos con la misma llave (respetando Retry-After) y, si sigue sin respuesta,
  "Verificando": reintento seguro o revisión del admin. El `X-Request-Id` de los errores queda guardado en el detalle
  (es lo que pide soporte junto con el `reference_code`).
- Una entrega puede tardar hasta un par de horas: nunca se repite un pedido mientras está en proceso.

## Limitaciones actuales
- Gift cards / PIN (productos sin datos de destino) no están soportados: requieren leer códigos con un permiso aparte.
- Sin cancelación ni reembolso por API: cualquier caso raro (entregado pero no llegó al cliente) se reporta a soporte de Central One con el `reference_code`.

## Despliegue en Render (plan gratis) + MongoDB Atlas (gratis)
La base es MongoDB: así los datos sobreviven a reinicios y despliegues aunque Render gratis no tenga disco.
1. **Atlas**: crea un cluster M0 (gratis) → Database Access: usuario y contraseña → Network Access: `0.0.0.0/0`
   (Render gratis no tiene IP fija) → Connect → Drivers → copia la cadena `mongodb+srv://...`.
2. **Render**: New → Web Service → tu repo. Runtime Node · Instance Type **Free** · Build `npm install` · Start `node server.js` · Health check `/healthz`.
3. Variables: `MONGODB_URI`, `SESSION_SECRET` (32+ caracteres), `COOKIE_SECURE=true`, `TRUST_PROXY=true`, `PROVIDER_MODE=real`,
   `PROVIDER_API_KEY`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` (10+; solo para el primer arranque, bórrala después), opcional `MONGODB_DB` (por defecto `panel`) y `WEBHOOK_SECRET`.
4. **UptimeRobot**: monitor HTTP(s) a `https://TU-SERVICIO.onrender.com/healthz`, intervalo 5 min, para que Render no lo duerma.
- Si el servicio se reinicia justo después de cobrar un pedido, a los ~2 min se reenvía solo con la misma Idempotency-Key (no se duplica).
- Para probar en local sin Mongo: `MEMORY_DB=1 node server.js` (base en memoria, se borra al apagar; **nunca en producción**).
