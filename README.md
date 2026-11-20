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

## Funciones extra
- **Pedir saldo (USDT BEP20)**: el revendedor ve tu billetera (`USDT_WALLET`), envía y pega el hash. El panel lo verifica en BSC
  con `BSC_RPC_URL` (NodeReal): contrato oficial de USDT, destino tu billetera, transacción exitosa, 15 confirmaciones y hash no usado.
  - Desde una billetera **de confianza** de ese revendedor → se abona solo.
  - Billetera **nueva** → verificada, pero la apruebas tú una vez (y marcas "confiar" si no es de un exchange).
  - Si no cuadra (otra red, otro token, otra billetera) o no hay hash → revisión manual en la pestaña *Saldo*.
- **Ganancias**: pestaña con hoy / semana / mes, gráfica de 14 días, por revendedor y por producto (solo recargas completadas).
- **Respaldo**: Resumen → *Descargar respaldo* (JSON con revendedores, saldos y pedidos; sin las fotos). Guárdalo en lugar seguro.
- **Telegram** (opcional): variable `TELEGRAM_BOT_TOKEN` (bot creado con @BotFather). Cada usuario pulsa *Conectar Telegram*.
  El admin recibe solicitudes de saldo, pedidos para revisar y saldo bajo; el revendedor, sus recargas y abonos.
- **Alerta de saldo bajo**: Resumen → monto mínimo; se revisa cada 10 min (máx. un aviso cada 3 h).
- **Recientes / Repetir**: el revendedor reutiliza IDs ya usados en el mismo juego y región.
- Precios en **USDT** para revendedores = costo de Central One + margen % del revendedor.
- **Registro**: los revendedores se crean la cuenta con correo y contraseña (Resumen → Registro: cerrado / con aprobación / abierto).
  Las cuentas nuevas con aprobación aparecen en *Revendedores → Pendientes*.
- **Tasas CUP**: Resumen → tasa transferencia y tasa saldo móvil (CUP por 1 USDT). Solo visual; se cobra en USDT.
- **Aviso para revendedores**: mensaje que ven arriba en su panel.

## Sub-administradores y registro de actividad
- **Equipo** (solo el dueño): crea sub-administradores con contraseña de 10+ caracteres y elige qué pueden hacer:
  *Aprobar saldo* (con tope por aprobación en USDT y en CUP), *Pedidos* (sin costos ni ganancias) y *Revendedores*
  (crear cuentas, aprobar registros, activar/desactivar). Puedes cambiar permisos, clave o desactivarlos cuando quieras.
- **Nunca pueden**: ver costos/ganancias/reportes, tocar catálogo, precios o ajustes, ajustar saldos a mano, cambiar márgenes
  o claves de revendedores, confiar en billeteras, descargar respaldos, ver el registro ni crear otros sub-admins.
  Esto lo exige el servidor (no solo la pantalla): si lo intentan, responde 403 y queda anotado como "Negado".
- Si un sub-admin aprueba o rechaza un saldo, el dueño recibe aviso por Telegram (si está activado).
- **Registro** (solo el dueño): quién hizo qué, sobre quién, cuándo y desde qué IP (accesos y accesos fallidos, saldos, pedidos,
  cambios de cuentas, ajustes, respaldos). Filtros, buscador y descarga CSV. Se conserva 180 días. Nunca guarda contraseñas ni fotos.
- Todos los usuarios pueden cambiar su propia contraseña desde su cuenta.

## Seguridad, fondos y respaldo (novedades)
- **Verificación en dos pasos (2FA)** para el dueño y los sub-admins (Google Authenticator, Authy…): se activa en *Mi cuenta* / *Equipo*,
  entrega 8 códigos de recuperación de un solo uso y no admite reutilizar un código. El dueño puede **exigirla** a los sub-admins
  (sin ella solo entran a "Mi cuenta") y quitársela a uno que perdió el teléfono. Si TÚ pierdes teléfono y códigos: pon la variable
  `RESET_2FA_FOR=tu_usuario` en Render, reinicia y bórrala después.
- **Sesiones revocables**: cambiar una clave, "Cerrar todas las sesiones" o "Cerrar sesiones" (desde Equipo) invalidan las cookies abiertas.
- **Respaldo automático** cada 7 días a tu Telegram (sin contraseñas ni fotos) + botón "Enviar respaldo a mi Telegram". Requiere
  `TELEGRAM_BOT_TOKEN` y tener tu Telegram conectado. El botón "Descargar completo" sí incluye las claves cifradas: guárdalo bien.
- **Pedidos y Solicitudes de saldo**: filtros por estado, método y fechas, con lupa (busca en todo el historial, no solo lo último).
- **Sub-admin con "Ajustar saldo a mano"**: agrega o quita USDT/CUP con tope por ajuste y motivo obligatorio. Cada aprobación o ajuste
  del sub-admin te llega por Telegram y aparece en *Resumen → Saldo movido por tu equipo* y en *Registro → Saldo del equipo*.
- **Fondos** (dueño y sub-admins con permiso "Ver fondos"): saldo de Central One, total USDT/CUP de todos los revendedores,
  saldo por revendedor con buscador y, solo para el dueño, los límites de cada sub-admin.

## Novedades de esta versión
- **Restaurar respaldo** (Resumen → "Restaurar un respaldo", solo el dueño): sube el `.json` descargado o el `.json.gz` de Telegram. Primero ves qué trae sin cambiar nada;
  pide tu contraseña (y tu código 2FA) y escribir RESTAURAR; antes manda a tu Telegram una copia del estado actual. **Nunca borra datos**: "solo reponer lo que falte"
  (recomendado) o "sobrescribir con lo del respaldo". El respaldo de Telegram no trae contraseñas: las cuentas que se repongan quedan con la clave bloqueada hasta que se la cambies.
- **Avisos de seguridad por Telegram**: 3 y 5 intentos fallidos en una cuenta de dueño/sub-admin, y entrada desde una IP nueva.
- **Tasas CUP**: se anota cuándo las actualizaste; si pasan N días (por defecto 3) te avisa por Telegram y en el panel. Botón "Siguen vigentes".
- **Olvidé mi contraseña** (revendedores): código de 6 dígitos por Telegram (vence en 10 min, 5 intentos). Sin Telegram conectado, te avisa a ti para que le cambies la clave. Dueño y sub-admins no pueden usar este camino.
- **Historial del revendedor**: filtros (estado/tipo, moneda, fechas, buscador) y descarga CSV de recargas y de movimientos de saldo.
- **Modo mantenimiento** (Resumen): pausa las recargas con un mensaje para tus revendedores; ellos siguen viendo sus saldos y pueden pedir saldo.
- **Suspender pagos** (Saldo → "Pagos por método"): botón por método (USDT, Transferencia, Saldo móvil). Suspendido, los revendedores no pueden pedir saldo por ahí; sus saldos y solicitudes ya enviadas no cambian.
- **Ofertas separadas por tipo**: dentro de cada juego/región el revendedor ve pestañas Diamantes / Pases / Membresías (y Otros). Se detecta por el nombre del paquete;
  si alguno cae en el tipo equivocado, corrígelo en Catálogo → "Lo que ven tus revendedores" → botón "Tipo".
- **Monitoreo**: la dirección `/status` responde 503 si la base de datos no contesta. Úsala en UptimeRobot o BetterStack (gratis) para que te avisen si el panel se cae.
  También te avisa por Telegram si Central One deja de responder (y cuando vuelve).

## Si no puedes entrar a la cuenta principal
`ADMIN_USERNAME` y `ADMIN_PASSWORD` solo se usan **el primer arranque** y solo si la clave tiene **10 o más caracteres**: si es más corta no se crea el admin, y si ya existía, cambiarla en Render no la cambia.
Salida de emergencia: en Render → Environment agrega `RESET_PASSWORD_FOR` (tu usuario) y `RESET_PASSWORD_TO` (clave nueva, 10+), guarda y espera el reinicio.
Entra con esa clave y **borra las dos variables**. Si no existía ningún admin, lo crea. Para perder el 2FA usa `RESET_2FA_FOR=tu_usuario`.

## Control de equipo, márgenes y ranking (última versión)
- **Cupo de ajustes manuales por sub-admin** (Equipo): además del tope por ajuste, cada sub-admin tiene un **cupo total** en USDT y en CUP
  (transferencia + saldo móvil suman en el mismo cupo). Todo lo que **agrega o quita** a mano se va sumando; al llegar al cupo no puede mover más
  hasta que tú pulses **Restablecer cupo**. Él ve cuánto le queda antes de confirmar; tú ves el cupo usado/restante, el **desglose por revendedor**
  (+agregó / −quitó) desde el último restablecimiento y los últimos movimientos (también en Resumen). Aprobar solicitudes de saldo NO gasta este cupo.
  Al llegar al límite te avisa Telegram. Valores por defecto: 100 USDT y 50.000 CUP (cámbialos en la ficha de cada sub-admin).
- **Confiar en billeteras**: por revendedor (Revendedores → Más opciones) y como ajuste para cuentas nuevas (Ajustes → Registro). Con esto activo, la primera
  billetera USDT desde la que pague se registra y se abona sola. Una billetera ya asociada a otro revendedor nunca se abona sola.
- **Margen general** (Ajustes): un % para las cuentas nuevas y para todas las ya registradas. Las cuentas con **margen manual 🔒**
  (el que pones con "Cambiar margen", o al crear la cuenta con un margen distinto al general) **no cambian** con el margen general;
  solo tú las cambias, o las devuelves a automático. Al actualizar, las cuentas que ya tenían un margen distinto al general quedan marcadas como manuales (se hace una sola vez).
- **Ventas → Quién vende más**: ranking por cantidad de recargas (hoy / semana / mes / todo). **Fondos**: USDT, transferencia CUP y saldo móvil CUP de cada revendedor por separado, con orden y filtro.
- Interfaz reorganizada: Resumen más corto, nueva pestaña **Ajustes**, tarjetas por revendedor y ventana propia para agregar/quitar saldo.


## Límites separados por moneda y depósitos USDT sin mínimo (última versión)
- **Sub-administradores: límites independientes en 3 monedas.** El tope por aprobación, el tope por ajuste manual y el cupo total se fijan por separado en
  💲 USDT, 🏦 CUP transferencia y 📱 CUP saldo móvil. Gastar el cupo de una moneda no toca el de las otras. Las cuentas que ya existían conservan su valor CUP
  (se copia a transferencia y a saldo móvil) y lo que ya habían consumido se reparte entre ambas con el historial real, una sola vez al actualizar.
- **USDT desde 0.01**: ya no hay mínimo de 1 USDT (ni al pegar el hash ni al indicar el monto a mano).
- **Abono automático sin hash**: Saldo → *Billeteras de confianza* → "Agregar la billetera de un revendedor". Desde ese momento, todo USDT que llegue a tu billetera
  desde esa dirección se abona solo a ese revendedor (cualquier monto desde 0.01, con las mismas confirmaciones), sin que pegue hash ni mande comprobante.
  El panel revisa la blockchain cada 30 s y **solo mira bloques nuevos** (nunca abona pagos viejos). Se puede apagar con la casilla de esa misma tarjeta.
  Requiere `USDT_WALLET` y `BSC_RPC_URL` (NodeReal). Las billeteras desconocidas o de otro revendedor nunca se abonan solas.


## Comprobante de recarga (sin precio)
Cuando una recarga pasa a *Completada* el panel muestra un efecto de éxito (confeti) con una imagen de comprobante: paquete/diamantes, ID del jugador, nombre de la cuenta, tiempo que tardó y fecha. **Nunca incluye el precio.** Se puede compartir o guardar, y también desde *Historial → 🧾 Comprobante*.
El nombre de la cuenta sale de la verificación de ID de Central One (si el revendedor no pulsó «Verificar ID», el panel lo consulta solo en segundo plano al hacer el pedido). Si el juego no devuelve nombre, el comprobante dice «No disponible».

Los revendedores pueden poner el **nombre y el icono de su tienda** en *Cuenta → Mi tienda*; salen arriba del panel y en sus comprobantes (si no ponen nada, se usa Shop Fast).

## Inicio de sesión con Google (revendedores)
1. En https://console.cloud.google.com → *APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web*.
2. En **Orígenes de JavaScript autorizados** pon la dirección de tu panel (p. ej. `https://shopfast-1xu1.onrender.com`). No hace falta URI de redirección.
3. En Render agrega la variable `GOOGLE_CLIENT_ID` con el ID de cliente (termina en `.apps.googleusercontent.com`; no es secreto) y redespliega.

Si la variable no está, el botón no aparece. Entra por Google solo quien tenga el correo verificado; si el correo ya es una cuenta de revendedor, entra a esa cuenta. Si no existe, se aplica el ajuste de registro (cerrado / con aprobación / abierto). Admin y sub-admin siguen entrando solo con usuario, contraseña y 2FA.

## Seguridad de los depósitos USDT (importante)
El hash de una transacción es **público** (cualquiera lo ve en BscScan). Por eso el panel ya NO registra billeteras solo ni abona con el hash de una billetera desconocida:
- Un hash solo se abona solo si la billetera que envió ya está **registrada a ese revendedor por el administrador**.
- Si la billetera es nueva, queda pendiente y el admin debe confirmar con el cliente que ese pago es suyo antes de aprobar.
- Una transacción con pagos de varias billeteras distintas nunca se abona sola.
- Al arrancar esta versión se apaga "confiar en billeteras" en todas las cuentas, se revocan las billeteras registradas automáticamente y se manda un informe por Telegram (también queda guardado y sale en los logs de Render).

## Depósitos USDT con monto exacto (sin hash)
El revendedor escribe cuánto va a enviar (ej. 5 USDT) y el panel le da un monto único, por ejemplo **5.08** (el monto pedido más unos centavos únicos). Al llegar a tu billetera exactamente ese monto (por BSC/BEP20, con las confirmaciones configuradas) se abona solo ese revendedor, desde cualquier billetera, con cualquier saldo. Ya no se pega hash ni se manda captura.
- El monto exacto es el que identifica al cliente; los centavos extra son únicos entre los pagos pendientes (casi siempre de 1 a 20 centavos). Se abona TODO lo que envía (5.08).
- Cada pedido vence a las 24 h; cada revendedor puede tener 2 pagos esperando.
- Pagos que llegan a tu billetera y no coinciden con nada (monto redondo, sin pedido, exchange con comisión…) NO se abonan: aparecen en *Saldo → Pagos USDT sin identificar* y te llega aviso por Telegram para resolverlos a mano.
- Ya no existen las «billeteras de confianza»: se quitaron del panel y del servidor. Nada se abona por la billetera de origen, solo por el monto exacto.

## Seguridad de la cuenta de administrador
En el panel del dueño hay una pestaña **Seguridad** (⚠️ mientras la verificación en dos pasos esté apagada) con el estado de protección, la activación de 2FA (Google Authenticator, Authy…), el cambio de contraseña y el cierre de todas las sesiones. Mientras no actives la 2FA aparece un aviso rojo en todas las pestañas. Si pierdes el celular y los códigos de recuperación: variable `RESET_2FA_FOR=tu_usuario` en Render y la borras después de entrar.
