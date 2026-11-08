import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { digest } from '../src/worker.js';
import { createDatabase } from '../scripts/sqlite-adapter.mjs';
/**
 * Crea dos sesiones y comprueba que un cambio de acceso correcto invalide
 * ambas.
 * Antes prueba contraseña actual incorrecta, confirmación distinta y campo
 * vacío.
 * Después entra con el acceso nuevo y comprueba que ya no funcione el inicial.
 * Incluye contraseñas de un carácter y de trescientos caracteres para evitar
 * reintroducir límites de longitud.
 */
test('cambiar acceso requiere contraseña actual, guarda un hash y revoca todas las sesiones', async (t) => {
    const DB = createDatabase();
    t.after(() => DB.close());
    const original = crypto.randomUUID(), password = 'Una frase nueva de prueba 2026';
    const env = {
        DB, ADMIN_USERNAME: 'administrador', ADMIN_PASSWORD_SHA256: await digest(original)
    };
    const call = (path, method = 'GET', value, cookie, origin = 'https://aurian.test') => worker.fetch(new Request('https://aurian.test' + path, {
        method, headers: {
            Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {})
        }, ...(value ? { body: JSON.stringify(value) } : {})
    }), env);
    const login = async (username, pw) => call('/api/login', 'POST', {
        username, password: pw
    });
    const a = await login('administrador', original), b = await login('administrador', original);
    const cookie = a.headers.get('set-cookie').split(';')[0], second = b.headers.get('set-cookie').split(';')[0];
    const input = {
        username: 'nuevo_admin', currentPassword: original, newPassword: password, confirmPassword: password
    };
    assert.equal((await call('/api/admin/credentials', 'PUT', input)).status, 401);
    assert.equal((await call('/api/admin/credentials', 'PUT', input, cookie, 'https://evil.test')).status, 403);
    assert.equal((await call('/api/admin/credentials', 'PUT', {
        ...input, newPassword: '', confirmPassword: ''
    }, cookie)).status, 400);
    assert.equal((await call('/api/admin/credentials', 'PUT', {
        ...input, confirmPassword: 'Otra frase muy diferente'
    }, cookie)).status, 400);
    assert.equal((await call('/api/admin/credentials', 'PUT', {
        ...input, currentPassword: 'incorrecta'
    }, cookie)).status, 400);
    assert.equal((await call('/api/admin/data', 'GET', undefined, cookie)).status, 200);
    const change = await call('/api/admin/credentials', 'PUT', input, cookie);
    assert.equal(change.status, 200);
    assert.match(change.headers.get('set-cookie'), /Max-Age=0/);
    for (const token of [cookie, second]) {
        assert.equal((await call('/api/admin/data', 'GET', undefined, token)).status, 401);
    }
    assert.equal((await login('administrador', original)).status, 401);
    assert.equal((await login('nuevo_admin', original)).status, 401);
    const entered = await login('nuevo_admin', password);
    assert.equal(entered.status, 200);
    const newCookie = entered.headers.get('set-cookie').split(';')[0];
    const account = await (await call('/api/admin/data', 'GET', undefined, newCookie)).json();
    assert.equal(account.username, 'nuevo_admin');
    assert.equal(account.products.length, 6);
    assert.equal(account.password_hash, undefined);
    const record = await DB.prepare('SELECT * FROM admin_credentials WHERE id=1').first();
    assert.notEqual(record.password_hash, password);
    assert.notEqual(record.password_hash, await digest(password));
    assert.equal(record.revision, 1);
    assert.equal(record.salt.length, 32);
    const again = await call('/api/admin/credentials', 'PUT', {
        username: 'otro_usuario', currentPassword: password, newPassword: 'a', confirmPassword: 'a'
    }, newCookie);
    assert.equal(again.status, 200);
    assert.equal((await login('nuevo_admin', password)).status, 401);
    const shortLogin = await login('otro_usuario', 'a');
    assert.equal(shortLogin.status, 200);
    const shortCookie = shortLogin.headers.get('set-cookie').split(';')[0], longPassword = 'x'.repeat(300);
    assert.equal((await call('/api/admin/credentials', 'PUT', {
        username: 'otro_usuario', currentPassword: 'a', newPassword: longPassword, confirmPassword: longPassword
    }, shortCookie)).status, 200);
    assert.equal((await login('otro_usuario', longPassword)).status, 200);
});
/**
 * Una sesión válida no basta para cambiar el acceso si se desconoce la
 * contraseña actual.
 * La prueba acumula intentos incorrectos y confirma que se bloquee la
 * siguiente modificación.
 * Las credenciales usadas son ficticias y la base se destruye al finalizar la
 * prueba.
 */
test('cambio de acceso limita intentos de adivinar la contraseña actual', async (t) => {
    const DB = createDatabase();
    t.after(() => DB.close());
    const original = crypto.randomUUID(), env = {
        DB, ADMIN_USERNAME: 'admin', ADMIN_PASSWORD_SHA256: await digest(original)
    };
    const call = (path, body, cookie) => worker.fetch(new Request('https://aurian.test' + path, {
        method: path === '/api/login' ? 'POST' : 'PUT', headers: {
            Origin: 'https://aurian.test', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {})
        }, body: JSON.stringify(body)
    }), env);
    const r = await call('/api/login', {
        username: 'admin', password: original
    }), cookie = r.headers.get('set-cookie').split(';')[0];
    for (let i = 0; i < 5; i++) {
        assert.equal((await call('/api/admin/credentials', {
            username: 'otro', currentPassword: 'incorrecta', newPassword: 'Contraseña de prueba suficientemente larga', confirmPassword: 'Contraseña de prueba suficientemente larga'
        }, cookie)).status, 400);
    }
    assert.equal((await call('/api/admin/credentials', {
        username: 'otro', currentPassword: original, newPassword: 'Contraseña de prueba suficientemente larga', confirmPassword: 'Contraseña de prueba suficientemente larga'
    }, cookie)).status, 429);
});
