/**
 * Ejecuta el módulo real del menú con una interfaz mínima en memoria.
 * Se comprueba el almacenamiento y la navegación sin abrir WhatsApp ni enviar
 * mensajes. Las respuestas de API permiten cubrir éxito, rechazo y fallo de red.
 * No utiliza la base ni el almacenamiento del navegador de la instalación local.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/menu.js', import.meta.url), 'utf8')
    .replace(/^import .* from '\.\/common\.js';\r?\n/m, '');

/**
 * La interfaz de prueba registra los listeners del módulo, en vez de duplicar
 * su lógica. Así el submit ejecutado es el mismo que usa el navegador.
 * El almacenamiento se mantiene entre la primera carga y una segunda visita.
 */
async function createMenu(storage, orderError = null) {
    const elements = new Map();
    const navigations = [];
    const notices = [];
    const product = { id: 'aguachile', name: 'Aguachile', description: '', price_cents: 11000 };
    const fields = {
        delivery: { value: 'pickup', addEventListener() {} },
        street: {},
        neighborhood: {},
    };
    let resets = 0;

    function element(selector) {
        if (!elements.has(selector)) {
            elements.set(selector, {
                hidden: false,
                listeners: {},
                addEventListener(name, handler) { this.listeners[name] = handler; },
                scrollIntoView() {},
            });
        }
        return elements.get(selector);
    }

    const form = element('#order-form');
    form.elements = fields;
    form.reset = () => {
        resets++;
        fields.delivery.value = 'pickup';
    };

    const context = {
        $: element,
        escape: String,
        money: cents => '$' + (cents / 100).toFixed(2),
        localStorage: {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => storage.set(key, value),
        },
        document: {
            querySelector: element,
            querySelectorAll: () => [],
            addEventListener() {},
        },
        window: {
            addEventListener() {},
            scrollTo() {},
            location: {
                assign(url) {
                    // El carrito y la vista deben estar restablecidos antes de salir.
                    assert.equal(storage.get('aurian-cart'), '[]');
                    assert.equal(element('#cart-count').textContent, '0 productos');
                    assert.equal(element('#menu-screen').hidden, false);
                    navigations.push(url);
                },
            },
        },
        FormData: class {
            *[Symbol.iterator]() {
                yield ['name', 'Cliente de prueba'];
                yield ['delivery', fields.delivery.value];
            }
        },
        setInterval() {},
        showNotice: (...args) => notices.push(args),
        async api(path) {
            if (path === '/api/order') {
                if (orderError) {
                    throw orderError;
                }
                return { url: 'https://wa.me/525512345678?text=pedido-de-prueba' };
            }
            return {
                products: [product],
                settings: {
                    name: 'Aurian', tagline: '', address: 'Dirección de prueba',
                    catalogConfirmed: true, scheduleReady: false,
                },
                status: { open: true, label: 'Abierto' },
            };
        },
    };

    vm.runInNewContext(source, context, { filename: 'menu.js' });
    // refresh es asíncrona; esperamos a que termine la primera carga del catálogo.
    await new Promise(resolve => setImmediate(resolve));
    return { element, form, navigations, notices, resets: () => resets };
}

test('continuar a WhatsApp vacía el carrito y la siguiente visita comienza sin productos', async () => {
    const storage = new Map([
        ['aurian-cart', JSON.stringify([{ id: 'aguachile', quantity: 2, price_cents: 11000 }])],
    ]);
    const menu = await createMenu(storage);
    assert.equal(menu.element('#cart-count').textContent, '2 productos');

    await menu.form.listeners.submit({ preventDefault() {}, target: menu.form });

    assert.equal(menu.navigations.length, 1);
    assert.equal(menu.resets(), 1);
    assert.equal(menu.element('#order-screen').hidden, true);
    assert.equal(menu.element('#order-total').textContent, '$0.00');
    assert.equal(menu.element('#view-order').disabled, true);

    const nextVisit = await createMenu(storage);
    assert.equal(nextVisit.element('#cart-count').textContent, '0 productos');
    assert.doesNotMatch(nextVisit.element('#products').innerHTML, /Agregar \+\s*\(2\)/);
});

test('un rechazo o un fallo de conexión conserva el pedido para corregirlo', async () => {
    for (const error of [
        Object.assign(new Error('Revisa el pedido.'), { status: 400 }),
        Object.assign(new Error('Cambió un precio.'), { status: 409, refresh: true }),
        Object.assign(new Error('Cerrado'), { status: 403 }),
        new Error('No se pudo conectar.'),
    ]) {
        const storage = new Map([
            ['aurian-cart', JSON.stringify([{ id: 'aguachile', quantity: 2, price_cents: 11000 }])],
        ]);
        const menu = await createMenu(storage, error);
        await menu.form.listeners.submit({ preventDefault() {}, target: menu.form });
        assert.equal(JSON.parse(storage.get('aurian-cart'))[0].quantity, 2);
        assert.equal(menu.element('#cart-count').textContent, '2 productos');
        assert.equal(menu.navigations.length, 0);
        assert.equal(menu.resets(), 0);
        assert.equal(menu.notices.at(-1)[0], error.message);
    }
});
