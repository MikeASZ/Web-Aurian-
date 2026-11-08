import test from 'node:test';
import assert from 'node:assert/strict';
import { operatingStatus, settingsInput, productInput, orderInput, buildOrder } from '../src/domain.js';
const base = {
    name: 'Aurian', tagline: '', address: 'Calle de ejemplo 1', mapUrl: '', whatsapp: '525512345678', logoId: null, scheduleReady: true, catalogConfirmed: true, temporaryClosed: false, hours: Array.from({ length: 7 }, () => ({
        open: '12:00', close: '20:00'
    }))
};
/**
 * Fija instantes UTC que corresponden al inicio y cierre del horario en CDMX.
 * Comprueba el minuto anterior, la apertura exacta y el cierre exacto.
 * La prueba no depende del reloj real ni de la zona horaria de la computadora
 * donde se ejecuta.
 */
test('horario de CDMX: apertura incluida y cierre excluido', () => {
    assert.equal(operatingStatus(base, new Date('2026-11-07T17:59:00Z')).open, false);
    assert.equal(operatingStatus(base, new Date('2026-11-07T18:00:00Z')).open, true);
    assert.equal(operatingStatus(base, new Date('2026-11-08T02:00:00Z')).open, false);
    assert.match(operatingStatus(base, new Date('2026-11-08T02:00:00Z')).label, /mañana/);
});
/**
 * Prueba cada bloqueo operativo con una hora que normalmente estaría abierta.
 * Cada iteración cambia una sola condición y conserva el resto de la
 * configuración válida.
 * Así se comprueba la prioridad de cierre temporal, datos pendientes y
 * teléfono ausente.
 */
test('los bloqueos de operación prevalecen sobre el horario', () => {
    const date = new Date('2026-11-07T18:30:00Z');
    for (const override of [{ scheduleReady: false }, { temporaryClosed: true }, { catalogConfirmed: false }, { whatsapp: '' }]) {
        assert.equal(operatingStatus({
            ...base, ...override
        }, date).open, false);
    }
});
/**
 * Envía entradas inválidas directamente a las reglas, sin utilizar el
 * formulario del navegador.
 * Comprueba horario invertido, enlace inseguro, precio no entero y domicilio
 * incompleto.
 * Verifica que el servidor no dependa de las restricciones HTML para aceptar
 * datos coherentes.
 */
test('valida horarios, precio y campos de domicilio en el servidor', () => {
    assert.throws(() => settingsInput({
        ...base, hours: base.hours.map(() => ({
            open: '20:00', close: '12:00'
        }))
    }), /cierre/);
    assert.throws(() => settingsInput({
        ...base, mapUrl: 'javascript:alert(1)'
    }), /https/);
    assert.throws(() => productInput({
        name: 'A', price_cents: 10.5, position: 1, available: true
    }), /precio/);
    assert.throws(() => orderInput({
        name: 'Ana', delivery: 'delivery', items: [{
                id: 'a', quantity: 1, price_cents: 100
            }]
    }));
    assert.throws(() => orderInput({
        name: 'Ana', delivery: 'pickup', items: [{
                id: 'a', quantity: 0, price_cents: 100
            }]
    }));
});
/**
 * Usa precios conocidos para verificar cantidades, subtotal y texto del
 * mensaje.
 * Comprueba que el enlace conserve el texto al codificarlo y que no se agregue
 * un costo de envío.
 * También cambia precio y disponibilidad para exigir un conflicto antes de
 * continuar a WhatsApp.
 */
test('pedido de domicilio conserva subtotal sin mencionar envío y usa precios del servidor', () => {
    const products = [{
            id: 'a', name: 'Aguachile', price_cents: 11000, available: 1
        }];
    const input = {
        name: 'Ana', delivery: 'delivery', street: 'Calle 1', neighborhood: 'Centro', items: [{
                id: 'a', quantity: 2, price_cents: 11000
            }], notes: 'Sin cebolla'
    };
    const result = buildOrder(orderInput(input), products, base);
    assert.equal(result.total_cents, 22000);
    assert.match(result.message, /Subtotal de productos: \$220\.00/);
    assert.doesNotMatch(result.message, /env[ií]o/i);
    assert.match(result.message, /Colonia: Centro/);
    assert.equal(new URL(result.url).searchParams.get('text'), result.message);
    assert.throws(() => buildOrder(orderInput({
        ...input, items: [{
                id: 'a', quantity: 2, price_cents: 1
            }]
    }), products, base), /precio/);
    assert.throws(() => buildOrder(orderInput(input), [{
            ...products[0], available: 0
        }], base), /disponible/);
    const pickup = buildOrder(orderInput({
        ...input, delivery: 'pickup'
    }), products, base);
    assert.match(pickup.message, /\nTotal:/);
    assert.doesNotMatch(pickup.message, /Dirección:/);
});
