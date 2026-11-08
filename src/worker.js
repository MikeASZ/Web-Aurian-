/** API HTTP: coordina validaciones, autenticación y persistencia en SQLite/D1. */
import { HttpError, productInput, settingsInput, operatingStatus, orderInput, buildOrder } from './domain.js';
import { hex, digest, credentials, passwordHash, verifyPassword, attempt } from './auth.js';
export { digest } from './auth.js';
const MAX_IMAGE = 180 * 1024;
/**
 * Crea respuestas JSON con tipo de contenido y estado HTTP consistentes.
 * Cache-Control no-store evita reutilizar respuestas administrativas y estados
 * de operación obsoletos.
 * headers permite añadir datos especiales, por ejemplo Set-Cookie, sin repetir
 * la construcción de la respuesta.
 * No serializa archivos binarios: las imágenes utilizan su propia respuesta.
 */
function json(value, status = 200, headers = {}) {
    return new Response(JSON.stringify(value), {
        status, headers: {
            'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers
        }
    });
}
/**
 * Lee únicamente objetos JSON del tamaño permitido para los formularios de la
 * API.
 * Delega el límite de bytes en limitedBody y convierte JSON inválido en un
 * error comprensible.
 * También rechaza null y arreglos en la raíz, aunque sean JSON sintácticamente
 * válido.
 * No valida los campos del negocio: esa responsabilidad está en domain.js y en
 * cada controlador.
 */
async function body(request) {
    if (!request.headers.get('content-type')?.startsWith('application/json')) {
        throw new HttpError(415, 'Formato de solicitud no admitido.');
    }
    const bytes = await limitedBody(request, 20 * 1024);
    try {
        const v = JSON.parse(new TextDecoder().decode(bytes));
        if (!v || typeof v !== 'object' || Array.isArray(v)) {
            throw new Error();
        }
        return v;
    }
    catch {
        throw new HttpError(400, 'Solicitud no válida.');
    }
}
/**
 * Lee el flujo de entrada por fragmentos sin confiar solamente en Content-
 * Length.
 * Si un cliente omite o falsea el tamaño, el contador real sigue limitando la
 * memoria utilizada.
 * Al superar el límite cancela la lectura y devuelve un error 413.
 * Al terminar reúne los fragmentos en un arreglo binario para que el llamador
 * elija cómo interpretarlo.
 */
async function limitedBody(request, limit) {
    if (Number(request.headers.get('content-length')) > limit) {
        throw new HttpError(413, 'El archivo o la solicitud es demasiado grande.');
    }
    const reader = request.body?.getReader();
    if (!reader) {
        return new Uint8Array();
    }
    let length = 0;
    const chunks = [];
    while (true) {
        const { value, done } = await reader.read();
        if (done) {
            break;
        }
        length += value.length;
        if (length > limit) {
            await reader.cancel();
            throw new HttpError(413, 'El archivo o la solicitud es demasiado grande.');
        }
        chunks.push(value);
    }
    const result = new Uint8Array(length);
    let offset = 0;
    for (const c of chunks) {
        result.set(c, offset);
        offset += c.length;
    }
    return result;
}
/**
 * Auxiliar de consulta para obtener una fila o null mediante la interfaz de
 * D1.
 * Los argumentos se pasan a bind y no se concatenan con el texto SQL.
 * Es una función flecha con retorno implícito: el resultado de first se
 * devuelve directamente.
 * La misma interfaz funciona con el adaptador SQLite de desarrollo.
 */
const one = (db, sql, ...args) => db.prepare(sql).bind(...args).first();
/**
 * Auxiliar asíncrono para consultas que devuelven varias filas.
 * Espera el resultado de D1 y extrae results, ocultando ese detalle al resto
 * de los controladores.
 * Devuelve el arreglo de registros, no una copia modificada de cada producto.
 * Toda consulta que use este auxiliar sigue siendo entrada/salida a la base.
 */
const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;
/**
 * Obtiene el JSON de configuración y su número de revisión en una sola
 * lectura.
 * La revisión permite detectar si otro administrador guardó cambios después de
 * cargar el formulario.
 * El JSON se convierte en objeto para que las reglas del negocio no dependan
 * del almacenamiento SQL.
 * El registro único id=1 se crea mediante la migración inicial.
 */
async function config(db) {
    const row = await one(db, 'SELECT data,revision FROM settings WHERE id=1');
    return {
        settings: JSON.parse(row.data), revision: row.revision
    };
}
/**
 * Comprueba el token de la cookie sin guardar el token original en la base.
 * Busca su hash y valida tanto el vencimiento como la revisión actual de
 * credenciales.
 * Cambiar el usuario o la contraseña invalida cualquier sesión con una
 * revisión anterior.
 * Un error 401 hace que la interfaz vuelva al formulario de acceso.
 * La cookie no contiene contraseña ni datos del negocio.
 */
async function session(request, env) {
    const token = request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith('aurian_session='))?.slice(15);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) {
        throw new HttpError(401, 'Inicia sesión para continuar.');
    }
    const hash = await digest(token), row = await one(env.DB, 'SELECT expires_at,credential_revision FROM sessions WHERE token_hash=?', hash), current = await credentials(env);
    if (!row || row.expires_at <= Date.now() || row.credential_revision !== (current?.revision || 0)) {
        throw new HttpError(401, 'Tu sesión terminó. Vuelve a iniciar sesión.');
    }
    return hash;
}
/**
 * Construye la cookie de sesión con el mismo alcance al crearla y al
 * eliminarla.
 * HttpOnly impide leerla desde JavaScript del navegador y SameSite limita su
 * envío entre sitios.
 * Secure se agrega en HTTPS, mientras el servidor local utiliza HTTP de
 * loopback.
 * Un Max-Age igual a cero ordena al navegador retirar la cookie después de
 * cerrar sesión.
 */
function cookie(request, value, maxAge) {
    return `aurian_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
/**
 * Comprueba la referencia de una imagen antes de asociarla a un producto o al
 * logo.
 * null permite dejar la fotografía vacía y utilizar la presentación de
 * respaldo.
 * Una referencia desconocida se rechaza para evitar guardar relaciones rotas.
 * Esta verificación complementa las claves foráneas de los productos.
 */
async function validImageId(db, id) {
    if (id !== null && (typeof id !== 'string' || !await one(db, 'SELECT id FROM media WHERE id=?', id))) {
        throw new HttpError(400, 'La imagen seleccionada ya no existe.');
    }
}
/**
 * Elimina fotografías antiguas que ningún producto ni el logo utilizan.
 * El margen de un día protege una subida cuyo formulario todavía no se ha
 * guardado.
 * La limpieza se ejecuta durante operaciones administrativas y no en cada
 * visita al menú.
 * Se conservan las imágenes asociadas aunque el producto esté oculto
 * temporalmente.
 */
async function cleanupImages(db) {
    // El día de margen protege una imagen recién subida cuyo formulario aún no se guardó.
    const { settings } = await config(db);
    await db.prepare('DELETE FROM media WHERE created_at < ? AND id NOT IN (SELECT image_id FROM products WHERE image_id IS NOT NULL) AND id != ?').bind(Date.now() - 86400000, settings.logoId || '').run();
}
/**
 * Punto de enrutamiento que decide qué operación ejecutar por ruta y método
 * HTTP.
 * Las rutas públicas consultan el menú o preparan pedidos; las administrativas
 * requieren sesión.
 * Se comprueba el origen antes de cualquier escritura de API para rechazar
 * formularios de otro sitio.
 * Los controladores llaman a funciones de dominio y usan consultas
 * parametrizadas.
 * Los errores esperados se transforman en respuestas en el manejador fetch
 * externo.
 */
async function handle(request, env) {
    const url = new URL(request.url), path = url.pathname, method = request.method, db = env.DB;
    if (path.startsWith('/api/') && !['GET', 'HEAD'].includes(method) && request.headers.get('origin') !== url.origin) {
        throw new HttpError(403, 'Origen de solicitud no permitido.');
    }
/**
 * Consulta pública del catálogo y del estado operativo del negocio.
 * El SQL solo expone productos disponibles, ya ordenados para la presentación.
 * El estado se calcula en el servidor y no según el reloj del dispositivo del
 * cliente.
 * La respuesta no contiene sesiones, contraseñas ni registros de clientes.
 */
    if (path === '/api/menu' && method === 'GET') {
        const { settings } = await config(db), products = await all(db, 'SELECT * FROM products WHERE available=1 ORDER BY position,name');
        return json({
            settings, products, status: operatingStatus(settings), serverTime: new Date().toISOString()
        });
    }
/**
 * Última verificación antes de abrir WhatsApp: horario, modalidad y catálogo
 * actual.
 * El servidor puede rechazar el pedido aunque el botón del navegador aún
 * pareciera habilitado.
 * La dirección es obligatoria para recoger porque el cliente necesita saber
 * dónde acudir.
 * No se crea una tabla de pedidos: el resultado es únicamente el mensaje y su
 * enlace.
 */
    if (path === '/api/order' && method === 'POST') {
        const { settings } = await config(db), status = operatingStatus(settings);
        if (!status.open) {
            throw new HttpError(403, status.label);
        }
        const order = orderInput(await body(request));
        if (order.delivery === 'pickup' && !settings.address.trim()) {
            throw new HttpError(403, 'La dirección de recogida aún no está configurada.');
        }
        const products = await all(db, 'SELECT * FROM products WHERE available=1');
        // Preparar el enlace no envía el mensaje ni guarda información del cliente.
        return json(buildOrder(order, products, settings));
    }
/**
 * Autenticación pública protegida con una ventana de intentos fallidos.
 * Verifica el usuario y la contraseña y crea un token aleatorio independiente
 * del secreto del usuario.
 * La base guarda el hash del token y una caducidad de ocho horas.
 * El token original solo viaja en la cookie de sesión y no se incluye en la
 * respuesta JSON.
 */
    if (path === '/api/login' && method === 'POST') {
        if (!env.ADMIN_PASSWORD_SHA256 || !env.ADMIN_USERNAME) {
            throw new HttpError(503, 'El acceso administrativo aún no está configurado.');
        }
        const v = await body(request), now = Date.now();
        const key = await digest(request.headers.get('CF-Connecting-IP') || 'local');
        if ((await attempt(db, key, now)).attempts > 5) {
            throw new HttpError(429, 'Demasiados intentos. Vuelve a intentar en 15 minutos.');
        }
        const record = await credentials(env), valid = await verifyPassword(v.password, record, env);
        if (v.username !== (record?.username || env.ADMIN_USERNAME) || !valid) {
            throw new HttpError(401, 'Usuario o contraseña incorrectos.');
        }
        const token = hex(crypto.getRandomValues(new Uint8Array(32)));
        await db.batch([db.prepare('DELETE FROM login_limits WHERE ip_hash=?').bind(key), db.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now), db.prepare('INSERT INTO sessions(token_hash,expires_at,credential_revision) VALUES(?,?,?)').bind(await digest(token), now + 8 * 3600000, record?.revision || 0)]);
        return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, token, 8 * 3600) });
    }
/**
 * Puerta común de todas las operaciones administrativas.
 * La sesión se valida antes de leer datos privados o efectuar cambios en
 * productos y configuración.
 * Colocar la verificación en este nivel evita olvidar la autenticación al
 * añadir otra ruta administrativa.
 * El HTML del panel puede ser público; el acceso a sus datos y acciones
 * permanece protegido.
 */
    if (path.startsWith('/api/admin')) {
        const hash = await session(request, env);
        if (path === '/api/admin/session' && method === 'GET') {
            return json({ username: (await credentials(env))?.username || env.ADMIN_USERNAME });
        }
/**
 * Personalización del acceso: exige contraseña actual y confirmación de la
 * nueva.
 * La nueva contraseña no tiene un límite de caracteres impuesto por la regla
 * de negocio.
 * Se genera un salt, se guarda el hash y se incrementa la revisión del acceso.
 * La operación en lote actualiza credenciales y revoca las sesiones antiguas.
 * Una comprobación de revisión evita sobrescribir un cambio simultáneo de otra
 * sesión.
 */
        if (path === '/api/admin/credentials' && method === 'PUT') {
            const input = await body(request), username = typeof input.username === 'string' ? input.username.trim() : '';
            if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) {
                throw new HttpError(400, 'El usuario debe tener de 3 a 40 caracteres: letras, números, punto, guion o guion bajo.');
            }
            if (typeof input.newPassword !== 'string' || !input.newPassword) {
                throw new HttpError(400, 'Escribe la contraseña nueva.');
            }
            if (input.newPassword !== input.confirmPassword) {
                throw new HttpError(400, 'La confirmación no coincide con la contraseña nueva.');
            }
            const key = await digest('admin-credentials-change');
            if ((await attempt(db, key)).attempts > 5) {
                throw new HttpError(429, 'Demasiados intentos. Vuelve a intentar en 15 minutos.');
            }
            const record = await credentials(env);
            if (!await verifyPassword(input.currentPassword, record, env)) {
                throw new HttpError(400, 'La contraseña actual es incorrecta.');
            }
            // Otra sesión pudo cambiar el acceso mientras se verificaba la contraseña.
            await session(request, env);
            const salt = hex(crypto.getRandomValues(new Uint8Array(16))), value = await passwordHash(input.newPassword, salt, env.ADMIN_PASSWORD_SHA256), revision = record?.revision || 0;
            const results = await db.batch([
                db.prepare('INSERT INTO admin_credentials(id,username,password_hash,salt,revision) VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,password_hash=excluded.password_hash,salt=excluded.salt,revision=excluded.revision WHERE admin_credentials.revision=?').bind(username, value, salt, revision + 1, revision),
                db.prepare('DELETE FROM sessions WHERE credential_revision < ?').bind(revision + 1),
                db.prepare('DELETE FROM login_limits WHERE ip_hash=?').bind(key)
            ]);
            if (!results[0].meta.changes) {
                throw new HttpError(409, 'El acceso cambió en otra sesión. Vuelve a iniciar sesión.');
            }
            return json({
                ok: true, username
            }, 200, { 'Set-Cookie': cookie(request, '', 0) });
        }
        if (path === '/api/admin/logout' && method === 'POST') {
            await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(hash).run();
            return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, '', 0) });
        }
        if (path === '/api/admin/data' && method === 'GET') {
            return json({
                ...await config(db), username: (await credentials(env))?.username || env.ADMIN_USERNAME, products: await all(db, 'SELECT * FROM products ORDER BY position,name')
            });
        }
/**
 * Alta de un producto independiente, sin variantes ni categorías.
 * El identificador se genera en el servidor y el formulario no puede elegir
 * uno existente.
 * Se valida la referencia de la foto después de validar los campos del
 * producto.
 * El límite del catálogo evita que la instalación pequeña acumule registros
 * sin control.
 */
        if (path === '/api/admin/products' && method === 'POST') {
            if ((await one(db, 'SELECT COUNT(*) AS n FROM products')).n >= 50) {
                throw new HttpError(400, 'El menú admite hasta 50 productos.');
            }
            const p = productInput(await body(request));
            await validImageId(db, p.image_id);
            const id = crypto.randomUUID();
            await db.prepare('INSERT INTO products(id,name,description,price_cents,image_id,available,position) VALUES(?,?,?,?,?,?,?)').bind(id, p.name, p.description, p.price_cents, p.image_id, p.available ? 1 : 0, p.position).run();
            return json({ id }, 201);
        }
        const match = path.match(/^\/api\/admin\/products\/([a-zA-Z0-9-]{1,80})$/);
/**
 * Edición o eliminación de un producto seleccionado por identificador.
 * La revisión recibida debe coincidir con la base; de lo contrario se pide
 * actualizar la lista.
 * El UPDATE y el DELETE incluyen también la revisión en su condición SQL.
 * Así la protección sigue funcionando aunque el registro cambie después de la
 * primera lectura.
 */
        if (match && ['PUT', 'DELETE'].includes(method)) {
            const input = await body(request), id = match[1], existing = await one(db, 'SELECT * FROM products WHERE id=?', id);
            if (!existing) {
                throw new HttpError(404, 'Este producto ya no existe.');
            }
            if (!Number.isInteger(input.revision) || existing.revision !== input.revision) {
                throw new HttpError(409, 'El producto cambió en otra sesión. Actualiza la lista antes de editarlo.');
            }
            let result;
            if (method === 'DELETE') {
                result = await db.prepare('DELETE FROM products WHERE id=? AND revision=?').bind(id, input.revision).run();
            }
            else {
                const p = productInput(input);
                await validImageId(db, p.image_id);
                result = await db.prepare('UPDATE products SET name=?,description=?,price_cents=?,image_id=?,available=?,position=?,revision=revision+1 WHERE id=? AND revision=?').bind(p.name, p.description, p.price_cents, p.image_id, p.available ? 1 : 0, p.position, id, input.revision).run();
            }
            if (!result.meta.changes) {
                throw new HttpError(409, 'El producto cambió en otra sesión. Actualiza la lista.');
            }
            await cleanupImages(db);
            return json({ ok: true });
        }
/**
 * Guarda la configuración como una unidad con control de cambios simultáneos.
 * settingsInput devuelve solamente los campos admitidos y fija la zona horaria
 * de CDMX.
 * La revisión condiciona el UPDATE para impedir que un formulario antiguo
 * borre ajustes recientes.
 * Después de guardar se pueden retirar imágenes antiguas que quedaron sin
 * referencias.
 */
        if (path === '/api/admin/settings' && method === 'PUT') {
            const input = await body(request), settings = settingsInput(input);
            await validImageId(db, settings.logoId);
            if (!Number.isInteger(input.revision)) {
                throw new HttpError(400, 'Actualiza la configuración.');
            }
            const result = await db.prepare('UPDATE settings SET data=?,revision=revision+1 WHERE id=1 AND revision=?').bind(JSON.stringify(settings), input.revision).run();
            if (!result.meta.changes) {
                throw new HttpError(409, 'La configuración cambió en otra sesión. Actualiza antes de guardar.');
            }
            await cleanupImages(db);
            return json({ ok: true });
        }
/**
 * Recibe imágenes ya reducidas por el navegador y valida de nuevo su tamaño y
 * formato.
 * Se inspeccionan los bytes iniciales, porque el tipo declarado por el cliente
 * no basta.
 * Cada imagen obtiene una URL nueva; reemplazar una fotografía no reutiliza
 * una URL que pueda estar en caché.
 * Los bytes se guardan aparte del catálogo para no incluirlos en cada consulta
 * de productos.
 */
        if (path === '/api/admin/media' && method === 'POST') {
            const bytes = await limitedBody(request, MAX_IMAGE), mime = request.headers.get('content-type');
            const signature = String.fromCharCode(...bytes.slice(0, 12));
            const valid = (mime === 'image/webp' && signature.startsWith('RIFF') && signature.slice(8) === 'WEBP') || (mime === 'image/png' && bytes[0] === 137 && signature.slice(1, 4) === 'PNG') || (mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255);
            if (!valid || bytes.length < 16) {
                throw new HttpError(400, 'Selecciona una imagen PNG, JPEG o WebP válida.');
            }
            await cleanupImages(db);
            if ((await one(db, 'SELECT COUNT(*) AS n FROM media')).n >= 150) {
                throw new HttpError(400, 'Hay demasiadas imágenes pendientes. Intenta nuevamente mañana.');
            }
            const id = crypto.randomUUID();
            await db.prepare('INSERT INTO media(id,mime,bytes,created_at) VALUES(?,?,?,?)').bind(id, mime, bytes.buffer, Date.now()).run();
            return json({ id }, 201);
        }
        throw new HttpError(404, 'Ruta no encontrada.');
    }
/**
 * Ruta pública de lectura de imágenes por identificador generado.
 * El tipo de contenido corresponde al archivo validado al subirlo.
 * La respuesta puede almacenarse en caché porque ese identificador nunca
 * cambia de contenido.
 * HEAD devuelve las cabeceras sin enviar los bytes de la imagen.
 */
    const media = path.match(/^\/media\/([a-f0-9-]{36})$/);
    if (media && ['GET', 'HEAD'].includes(method)) {
        const row = await one(db, 'SELECT mime,bytes FROM media WHERE id=?', media[1]);
        if (!row) {
            throw new HttpError(404, 'Imagen no encontrada.');
        }
        return new Response(method === 'HEAD' ? null : new Uint8Array(row.bytes), { headers: {
                'Content-Type': row.mime, 'Cache-Control': 'public, max-age=86400, immutable'
            } });
    }
    if (path.startsWith('/api/')) {
        throw new HttpError(404, 'Ruta no encontrada.');
    }
    if (!['GET', 'HEAD'].includes(method)) {
        throw new HttpError(405, 'Método no permitido.');
    }
    if (path === '/admin' || path === '/admin/') {
        url.pathname = '/admin.html';
    }
    return env.ASSETS.fetch(new Request(url, request));
}
export default {
/**
 * Adaptador de entrada de Cloudflare Workers, reutilizado también por el
 * servidor local.
 * Captura errores del dominio para devolver el estado y mensaje esperados.
 * Los fallos internos reciben un aviso general sin revelar consultas o
 * secretos.
 * Aplica cabeceras de seguridad a todas las respuestas, incluso errores y
 * recursos estáticos.
 */
    async fetch(request, env) {
        let response;
        try {
            response = await handle(request, env);
        }
        catch (e) {
            response = e instanceof HttpError ? json({
                error: e.message, ...e.detail
            }, e.status) : json({ error: 'No pudimos completar la solicitud. Intenta nuevamente.' }, 500);
        }
        const secured = new Response(response.body, response);
        secured.headers.set('X-Content-Type-Options', 'nosniff');
        secured.headers.set('Referrer-Policy', 'no-referrer');
        secured.headers.set('X-Frame-Options', 'DENY');
        secured.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
        return secured;
    }
};
