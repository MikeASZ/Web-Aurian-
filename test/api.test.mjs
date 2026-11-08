import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { digest } from '../src/worker.js';
import { createDatabase } from '../scripts/sqlite-adapter.mjs';
/**
 * Construye una base en memoria y un acceso aleatorio exclusivo de cada
 * prueba.
 * call crea peticiones estándar y las entrega directamente al Worker, sin
 * abrir puertos de red.
 * login devuelve una cookie de prueba para recorrer rutas protegidas.
 * No se lee ni modifica la base, los archivos o el acceso que utiliza el
 * negocio en desarrollo.
 */
async function setup() {
    const DB = createDatabase(), password = crypto.randomUUID();
    const env = {
        DB, ADMIN_USERNAME: 'admin', ADMIN_PASSWORD_SHA256: await digest(password), ASSETS: { fetch: () => new Response('asset') }
    };
    const call = (path, method = 'GET', body, cookie, headers = {}) => worker.fetch(new Request('https://aurian.test' + path, {
        method, headers: {
            ...(method !== 'GET' ? {
                'Origin': 'https://aurian.test', 'Content-Type': 'application/json'
            } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers
        }, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {})
    }), env);
    const login = async () => {
        const r = await call('/api/login', 'POST', {
            username: 'admin', password
        });
        assert.equal(r.status, 200);
        return r.headers.get('set-cookie').split(';')[0];
    };
    return {
        DB, call, login, password
    };
}
/**
 * Recorre varias rutas como lo haría el panel: acceso, edición, actualización
 * y cierre de sesión.
 * Compara la revisión para detectar una modificación hecha con datos antiguos.
 * La consulta pública confirma que ocultar un producto se refleja en el
 * catálogo compartido.
 */
test('menú compartido: acceso protegido, modificaciones, conflictos y cierre', async (t) => {
    const { DB, call, login } = await setup();
    t.after(() => DB.close());
    assert.equal((await call('/api/admin/data')).status, 401);
    assert.equal((await call('/api/order', 'POST', {})).status, 403);
    const cookie = await login();
    const response = await call('/api/admin/data', 'GET', undefined, cookie);
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
    const data = await response.json(), p = data.products[0];
    assert.equal(data.products.length, 6);
    assert.equal((await call('/api/admin/products/' + p.id, 'PUT', {
        ...p, available: false
    }, cookie, { 'Origin': 'https://evil.test' })).status, 403);
    assert.equal((await call('/api/admin/products/' + p.id, 'PUT', {
        ...p, available: false
    }, cookie)).status, 200);
    assert.equal((await (await call('/api/menu')).json()).products.length, 5);
    assert.equal((await call('/api/admin/products/' + p.id, 'PUT', {
        ...p, available: true
    }, cookie)).status, 409);
    const next = await (await call('/api/admin/data', 'GET', undefined, cookie)).json();
    assert.equal((await call('/api/admin/settings', 'PUT', {
        ...next.settings, temporaryClosed: true, revision: next.revision
    }, cookie)).status, 200);
    assert.equal((await call('/api/admin/settings', 'PUT', {
        ...next.settings, revision: next.revision
    }, cookie)).status, 409);
    assert.equal((await (await call('/api/menu')).json()).status.open, false);
    assert.equal((await call('/api/admin/logout', 'POST', {}, cookie)).status, 200);
    assert.equal((await call('/api/admin/data', 'GET', undefined, cookie)).status, 401);
});
/**
 * Acumula accesos incorrectos y comprueba el bloqueo de la siguiente petición.
 * Después vence artificialmente la ventana y confirma que un acceso válido
 * puede continuar.
 * No espera quince minutos reales para comprobar una regla temporal.
 */
test('límite de intentos persiste en la base y expira', async (t) => {
    const { DB, call, login } = await setup();
    t.after(() => DB.close());
    for (let i = 0; i < 5; i++) {
        assert.equal((await call('/api/login', 'POST', {
            username: 'admin', password: 'incorrecta'
        })).status, 401);
    }
    assert.equal((await call('/api/login', 'POST', {
        username: 'admin', password: 'incorrecta'
    })).status, 429);
    await DB.prepare('UPDATE login_limits SET reset_at=0').run();
    await login();
});
/**
 * Rechaza SVG y archivos que exceden el tamaño permitido.
 * Después sube una imagen binaria pequeña y verifica que su ruta devuelva
 * exactamente los mismos bytes.
 * Esto prueba persistencia y formato de respuesta sin necesitar fotografías
 * privadas del negocio.
 */
test('imágenes persistentes, tamaño limitado y rechazo de SVG', async (t) => {
    const { DB, call, login } = await setup();
    t.after(() => DB.close());
    const cookie = await login();
    assert.equal((await call('/api/admin/media', 'POST', '<svg></svg>', cookie, { 'Content-Type': 'image/svg+xml' })).status, 400);
    assert.equal((await call('/api/admin/media', 'POST', 'x'.repeat(181 * 1024), cookie, { 'Content-Type': 'image/png' })).status, 413);
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const request = new Request('https://aurian.test/api/admin/media', {
        method: 'POST', headers: {
            Origin: 'https://aurian.test', 'Content-Type': 'image/png', Cookie: cookie
        }, body: bytes
    });
    // La imagen necesita una petición binaria; el auxiliar de pruebas serializa JSON.
    const env = {
        DB, ADMIN_USERNAME: 'admin'
    };
    const result = await worker.fetch(request, env);
    assert.equal(result.status, 201);
    const { id } = await result.json();
    const image = await call('/media/' + id);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), bytes);
});
/**
 * Controla el reloj para probar un negocio abierto y después la hora exacta de
 * cierre.
 * Configura datos ficticios, crea un producto y verifica el rechazo de un
 * precio manipulado.
 * El pedido válido devuelve el mensaje sin crear registros persistentes de
 * clientes o pedidos.
 */
test('pedido completo: alta, revisión de importe, WhatsApp y bloqueo al cerrar', async (t) => {
    t.mock.timers.enable({
        apis: ['Date'], now: new Date('2026-11-07T18:00:00Z')
    });
    const { DB, call, login } = await setup();
    t.after(() => DB.close());
    const cookie = await login();
    const data = await (await call('/api/admin/data', 'GET', undefined, cookie)).json();
    const settings = {
        ...data.settings, whatsapp: '525512345678', address: 'Dirección de prueba', scheduleReady: true, catalogConfirmed: true, hours: Array.from({ length: 7 }, () => ({
            open: '12:00', close: '13:00'
        })), revision: data.revision
    };
    assert.equal((await call('/api/admin/settings', 'PUT', settings, cookie)).status, 200);
    const created = await call('/api/admin/products', 'POST', {
        name: 'Producto de prueba', description: '', price_cents: 10001, available: true, position: 9
    }, cookie);
    assert.equal(created.status, 201);
    const { id } = await created.json();
    const order = {
        name: 'Cliente de prueba', delivery: 'delivery', street: 'Calle de prueba', neighborhood: 'Colonia de prueba', items: [{
                id, quantity: 3, price_cents: 1
            }]
    };
    assert.equal((await call('/api/order', 'POST', order)).status, 409);
    order.items[0].price_cents = 10001;
    const response = await call('/api/order', 'POST', order);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.total_cents, 30003);
    assert.match(result.message, /Subtotal de productos: \$300\.03/);
    assert.doesNotMatch(result.message, /env[ií]o/i);
    assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('orders','customers')").first()).n, 0);
    t.mock.timers.tick(3600000);
    assert.equal((await call('/api/order', 'POST', order)).status, 403);
    const current = await (await call('/api/admin/data', 'GET', undefined, cookie)).json(), p = current.products.find(p => p.id === id);
    assert.equal((await call('/api/admin/products/' + id, 'DELETE', { revision: p.revision }, cookie)).status, 200);
    assert.equal((await (await call('/api/menu')).json()).products.some(p => p.id === id), false);
});
