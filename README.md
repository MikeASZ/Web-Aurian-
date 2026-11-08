# Aurian · Menú y pedidos

Sistema de menú y pedidos para un negocio de aguachiles y ceviches. Desarrollado en JavaScript, con una interfaz en crema, azul, turquesa, naranja y coral. La ejecución local no requiere frameworks ni dependencias adicionales.

## Abrir en Visual Studio Code

Desde VS Code, usa **Archivo > Abrir área de trabajo desde archivo…** y selecciona `Aurian.code-workspace`, incluido en la carpeta del proyecto. También puedes abrir directamente la carpeta `aurian`.

- **F5:** inicia el servidor y abre la página local. La configuración se llama «Aurian: abrir página local».
- **Shift+F5:** detiene la ejecución.
- **Terminal > Ejecutar tarea > Aurian: ejecutar pruebas:** comprueba las reglas y la API.
- **Terminal > Ejecutar tarea > Aurian: consultar acceso local:** muestra tu usuario y contraseña del administrador en tu terminal. Ejecútala después del primer inicio.

El espacio de trabajo utiliza el comando `node` de una instalación de Node.js 24 o posterior. Para publicar con Wrangler también se necesita npm, incluido en la instalación estándar de Node.js. La configuración del proyecto no instala extensiones ni modifica los ajustes globales del editor.

## Probar en tu computadora

Necesitas **Node.js 24 o posterior**. Abre una terminal en esta carpeta:

```powershell
node scripts/dev.mjs
```

Abre **http://127.0.0.1:8787/**. El panel está en **http://127.0.0.1:8787/admin**.

En otra terminal, dentro de la misma carpeta, consulta tu acceso:

```powershell
node scripts/admin-key.mjs --show
```

El primer inicio crea una contraseña aleatoria fuerte y una base SQLite local en `.local/`. Los cambios sobreviven a los reinicios. No subas ni compartas `.local/`: contiene el acceso privado y los datos de tu instalación. Puedes personalizar el usuario y la contraseña desde **Mi acceso**; guarda tu contraseña en un gestor de contraseñas.

Para detener la aplicación, pulsa **Ctrl+C** en la terminal del servidor.

## Cambiar el usuario y la contraseña

Si la aplicación estaba ejecutándose antes de esta actualización, detén el servidor y vuelve a iniciarlo (en VS Code: **Shift+F5**, después **F5**). Recarga el panel administrativo.

1. Entra con tu acceso actual y abre la pestaña **Mi acceso**.
2. Escribe la contraseña actual y el usuario nuevo. El usuario admite de 3 a 40 caracteres: letras, números, punto, guion y guion bajo.
3. Escribe y confirma tu contraseña nueva. No se exige una longitud mínima ni máxima; no puede estar vacía. Se admiten espacios y frases largas.
4. Guarda. Se cerrarán todas las sesiones administrativas; inicia sesión con las credenciales nuevas.

El formulario requiere la contraseña actual y limita los intentos fallidos. La base guarda un hash derivado con PBKDF2, salt aleatorio y un secreto de servidor; nunca guarda la contraseña personalizada en texto claro. La configuración, el logo, los productos y las fotografías se conservan.

Después de personalizar el acceso, la tarea «consultar acceso local» solo muestra el usuario: ya no puede recuperar la contraseña. El acceso generado inicialmente deja de funcionar. Esta versión no incluye recuperación por correo; conserva la contraseña nueva.

Al detectar una migración pendiente, el servidor local crea un respaldo consistente en `.local/backups/` **antes** de actualizar el esquema. Se usan migraciones incrementales que conservan tus datos.

Al trasladar una base con acceso personalizado a Cloudflare, se deben conservar también los secretos de `.dev.vars`, generados desde la misma instalación, porque se usan para verificar el hash. No regeneres el secreto de arranque ni borres `.local/access.json` como forma de cambiar la contraseña: utiliza el panel. La base local y la publicada siguen siendo entornos separados.

## Qué incluye

- Menú sin categorías ni variantes. Cada presentación se registra como producto independiente.
- Carrito conservado en el navegador, con cantidades entre 1 y 99. Se restablece al continuar a WhatsApp después de validar el pedido; si la validación falla, conserva los productos para corregirlos.
- Recogida y entrega a domicilio. Campos del domicilio solo para entrega.
- «Total» para recogida y «Subtotal de productos» para domicilio, sin referencias al costo de envío.
- Enlace a WhatsApp preparado con productos, cantidades, importes y datos del formulario. El cliente envía el mensaje y el dueño confirma el pedido.
- Comprobación en el servidor de disponibilidad, precios y horario antes de generar el enlace.
- Administración con sesión privada, edición de productos, imágenes, visibilidad, orden y eliminación con confirmación.
- Configuración del negocio, logo, dirección, ubicación, WhatsApp, horario semanal y cierre temporal.
- Detección de ediciones concurrentes para evitar sobrescribir cambios sin advertencia.

Los clientes consultan el menú al entrar, al volver a la pestaña y cada minuto mientras está visible. Los precios y productos se revisan de nuevo al continuar a WhatsApp. No se implementan pagos, historial de pedidos, registro de clientes ni control de inventario.

## Datos provisionales y reglas

Los seis productos y precios provienen del menú de muestra. **No están confirmados**. El teléfono no se copió porque puede estar desactualizado. Horario, dirección, logo y fotos están pendientes.

Los pedidos permanecen bloqueados hasta confirmar en Configuración:

1. Productos y precios reales.
2. Horario semanal con al menos un día de atención.
3. WhatsApp del negocio: código **52** seguido de **10 dígitos**.

Para recogida también se requiere dirección. El cierre temporal prevalece sobre el horario. El menú y el carrito siguen disponibles cuando está cerrado. La hora se calcula en **America/Mexico_City** en el servidor; el cierre es exclusivo (a la hora de cierre ya no se aceptan pedidos).

Esta primera versión admite un intervalo de apertura y cierre por día, sin cruzar medianoche. Si el negocio necesita horarios partidos o nocturnos, se debe ampliar esa regla antes de configurar su horario real.

Los nombres, domicilios y observaciones se procesan para formar el mensaje y **no se guardan en la base de datos ni en el almacenamiento local del navegador**. El carrito conserva solamente los identificadores, cantidades y precios mostrados. Al abrir WhatsApp, el mensaje se transfiere a ese servicio.

## Imágenes sin un servicio adicional

Para este catálogo pequeño, las fotografías se reducen a un máximo de 900 píxeles y 180 KiB y se guardan en una tabla separada de la misma base. No se necesita R2 ni un proveedor de imágenes. Se aceptan JPEG, PNG y WebP; no SVG.

Es una decisión adecuada al tamaño de esta primera versión, no una solución para una biblioteca grande de fotografías. Las consultas del catálogo no incluyen los bytes de las imágenes. Las imágenes tienen URL propia y caché; las imágenes reemplazadas y sin uso se limpian después de un día, durante una operación administrativa.

## Estructura

```text
public/                  Interfaz del cliente y del administrador
src/domain.js            Reglas, validaciones, horario y mensaje del pedido
src/auth.js              Verificación de credenciales y límite de intentos
src/worker.js            API de Cloudflare Workers y autenticación
migrations/              Esquema SQL y datos de muestra para D1
scripts/dev.mjs          Servidor local
scripts/sqlite-adapter.mjs Adaptación de SQLite a la interfaz de D1 para pruebas locales
scripts/admin-key.mjs    Generación y consulta del acceso privado
test/                    Pruebas de reglas, API y persistencia
wrangler.jsonc           Configuración pendiente del ID real de D1
```

El servidor local utiliza la misma API y lógica del Worker, con SQLite. La publicación utiliza D1. **La base local no se sincroniza automáticamente con la de Cloudflare**: son entornos separados. Configura los datos reales en el panel publicado o realiza una importación deliberada cuando corresponda.

## Control de versiones con Git

El repositorio conserva el código, las pruebas y las migraciones. La base local, los archivos de acceso y los respaldos privados quedan excluidos mediante `.gitignore`.

Desde la carpeta del proyecto puedes comprobar el estado con:

```powershell
git status
git log --oneline -5
```

Antes de guardar otra versión, revisa los archivos modificados en el panel **Control de código fuente** de VS Code. Agrega los archivos que correspondan, comprueba los cambios y crea un commit con un mensaje breve que describa su propósito. Subir ese commit a GitHub requiere configurar el repositorio remoto y autenticar tu cuenta.

El repositorio de GitHub es público: permite consultar el código, las pruebas y las migraciones. Almacenar allí el código no publica la aplicación en Cloudflare ni respalda los datos de `.local/`. Para conservar productos, fotografías, configuración y acceso personalizado, guarda por separado una copia privada de la base y sus secretos de arranque.

## Entorno publicado en Cloudflare

- Menú: https://aurian-menu.aurian-menu.workers.dev/
- Administración: https://aurian-menu.aurian-menu.workers.dev/admin

El servidor se ejecuta en Cloudflare Workers y utiliza la base D1 `aurian`. Se trasladaron el catálogo, las imágenes, la configuración y el acceso personalizado de la instalación local. Las sesiones de desarrollo no se trasladan; inicia sesión con tu usuario y contraseña actuales.

La base local y la publicada son independientes. Para actualizar el menú que consultan los clientes, utiliza el panel de la dirección publicada. Los cambios de productos en tu computadora no se copian automáticamente a Internet.

### Publicar actualizaciones del código

Desde la carpeta del proyecto, instala las versiones registradas en el archivo de dependencias:

```powershell
npm.cmd ci
```

Si necesitas autorizar esta computadora, el acceso por código evita depender de un retorno a localhost:

```powershell
npx.cmd wrangler login --device --browser=false
npx.cmd wrangler whoami
```

Comprueba el código y publica la actualización:

```powershell
npm.cmd run test
npm.cmd run comments
npx.cmd wrangler deploy
```

El despliegue actualiza el código y los recursos de la interfaz; no reemplaza el catálogo de D1. Los secretos ya configurados se conservan. Si agregas una migración nueva, aplícala con `npx.cmd wrangler d1 migrations apply aurian --remote` después de revisar sus cambios.

### Instalar en otra cuenta

`wrangler.jsonc` contiene el identificador de la base del entorno publicado. Para una instalación independiente, crea tu propia base con `npx.cmd wrangler d1 create aurian`, coloca su identificador en la configuración y aplica las migraciones. Configura después los secretos administrativos de esa instalación. No reutilices el identificador de la base de otra cuenta.

La importación inicial de los datos se ejecutó una sola vez sobre una D1 nueva. Los archivos privados de traslado permanecen dentro de `.local/deploy/`, fuera del repositorio. No repitas esa importación para actualizar el código, porque sustituye el catálogo y la configuración del destino.

La gratuidad depende de mantenerse dentro de las cuotas de Cloudflare, no implica capacidad ilimitada. Consulta las cuotas antes de activar otros productos o planes.

## Documentación y programación funcional

El objetivo de comentarios se mide **sobre el conjunto del código fuente**: JavaScript, HTML, CSS, SQL y pruebas. El cálculo es `líneas completas de comentario / líneas no vacías × 100`. Incluye las marcas de los bloques de comentario; excluye Markdown, JSON, datos privados y archivos generados. Un porcentaje por sí solo no garantiza calidad: se priorizan reglas del negocio, autenticación, persistencia, migraciones y transformación de datos.

Puedes repetir la medición sin instalar herramientas adicionales:

```powershell
node scripts/comment-coverage.mjs --check
```

El comando muestra un desglose por archivo y falla si el total es menor del 30%. También está disponible en VS Code como **Terminal → Ejecutar tarea → Aurian: medir comentarios**. La descripción de la métrica y su desglose están en `DOCUMENTACION.md`.

El proyecto combina estilos de programación:

- **Funciones puras y validaciones:** las reglas de `src/domain.js` se prueban con entradas explícitas, separadas de la pantalla y de la base. `operatingStatus` recibe una fecha para poder probarla sin depender del reloj real.
- **`map`:** transforma una colección en otra, por ejemplo productos en tarjetas o días en intervalos validados.
- **`filter`:** conserva los elementos que cumplen una condición, por ejemplo líneas válidas del carrito o productos aún disponibles.
- **`reduce`:** combina elementos en un resultado, como el subtotal del carrito o el total de líneas del informe.
- **Callbacks y funciones de orden superior:** `action` recibe otra función y centraliza el bloqueo y los errores; los listeners reciben funciones que se ejecutan al ocurrir eventos.
- **Efectos e implementación imperativa:** modificar el DOM, escribir en SQLite, guardar en localStorage y realizar peticiones son efectos. Usar una función flecha o `map` no vuelve automáticamente pura una operación. Los comentarios señalan los callbacks que modifican objetos o acumuladores.

## Verificar cambios

El código usa indentación de **cuatro espacios**, archivos UTF-8 y comentarios en español que explican las reglas y decisiones importantes. Las condiciones y los bucles usan llaves explícitas. Las reglas del negocio, la autenticación, las peticiones HTTP y la interfaz se mantienen en módulos separados.

La carpeta `.vscode/` configura el formato automático al guardar con los formateadores incluidos en VS Code. `.editorconfig` documenta la misma convención para otros editores compatibles. No se necesitan extensiones ni dependencias adicionales para ejecutar la página.

Al modificar el proyecto:

1. Edita la interfaz en `public/` y las reglas en `src/`.
2. Guarda el archivo para aplicar el formato. Comenta el motivo de una decisión cuando no sea evidente por el código.
3. Si cambia la base, agrega una migración nueva; no reescribas una migración ya aplicada para modificar datos existentes.
4. Ejecuta las pruebas y comprueba el flujo afectado desde el navegador antes de publicar.

```powershell
node --test test/*.test.mjs
```

Las pruebas cubren apertura y cierre en CDMX, bloqueos operativos, datos inválidos, importes calculados por el servidor, cambios de precio o disponibilidad, protección del panel, origen de las peticiones, sesiones, límite de intentos, imágenes, cambio de credenciales, revocación de sesiones, respaldo de migración y persistencia tras reiniciar.

La API y las reglas se probaron localmente con SQLite. Falta verificar el despliegue con D1 real y la revisión visual en navegador antes de usarlo con clientes.

## Referencias técnicas

- [Configuración de Wrangler](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [D1: base y consultas preparadas](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Límites de D1](https://developers.cloudflare.com/d1/platform/limits/)
- [Secretos de Workers](https://developers.cloudflare.com/workers/configuration/secrets/)

## Continuidad con PUDS

Se mantienen cliente y administrador como actores. Producto corresponde a la tabla `products`; el carrito pertenece al navegador; las funciones de `domain.js` calculan los importes y preparan el pedido; `worker.js` coordina la aplicación; D1 cumple la persistencia.

Las decisiones acordadas modifican el modelo anterior: no habrá categorías ni variantes, cada producto tendrá un solo precio, el formulario dependerá del tipo de entrega y los pedidos se bloquearán fuera de horario. No existe una entidad persistente Pedido porque la confirmación sucede en WhatsApp. Estas decisiones se deben reflejar en la siguiente actualización de los diagramas.
