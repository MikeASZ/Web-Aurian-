/** Menú del cliente: conserva el carrito en el navegador, pero no el domicilio. */
import { $, escape, money, api, showNotice } from './common.js';
let products = [];
let settings = {};
let status = {
    open: false,
    label: 'Consultando disponibilidad…'
};
let online = false;
let busy = false;
let cart = [];
/**
 * Recupera el carrito de la visita anterior sin confiar en su contenido
 * almacenado.
 * filter conserva entradas con tipos y cantidades válidos; slice limita
 * cuántas líneas se cargan.
 * Un segundo filter usa findIndex para conservar solo la primera aparición de
 * cada identificador.
 * La cadena crea arreglos nuevos, pero los objetos todavía se comparten: no
 * equivale a una copia profunda.
 * Un error del almacenamiento deja un carrito vacío y no bloquea la consulta
 * del menú.
 */
try {
    const saved = JSON.parse(localStorage.getItem('aurian-cart') || '[]');
    if (Array.isArray(saved)) {
        cart = saved.filter(i => typeof i.id === 'string' && Number.isInteger(i.quantity) && i.quantity > 0 && i.quantity <= 99 && Number.isInteger(i.price_cents)).slice(0, 50).filter((v, i, a) => a.findIndex(x => x.id === v.id) === i);
    }
}
catch {
    // Si el almacenamiento está bloqueado o dañado, comenzamos con un carrito vacío.
}
/**
 * Guarda el estado mínimo necesario para recuperar el carrito en este
 * navegador.
 * No guarda el nombre, domicilio ni observaciones escritos en el formulario.
 * localStorage es un efecto persistente del navegador, no una operación de
 * programación funcional pura.
 * Si el usuario bloquea el almacenamiento, el pedido sigue funcionando en
 * memoria.
 */
function save() {
    try {
        localStorage.setItem('aurian-cart', JSON.stringify(cart));
    }
    catch {
        // El pedido sigue funcionando en memoria aunque el navegador no permita guardarlo.
    }
}
/**
 * Restablece el pedido después de la validación del servidor y antes de abrir
 * WhatsApp. Así, volver desde la aplicación o recargar no recupera los productos
 * del pedido anterior.
 * Actualiza la memoria y el almacenamiento, limpia el formulario y muestra el
 * menú con cantidades en cero. Es una operación con efectos sobre la interfaz.
 * No se llama si falla la validación, para permitir que el cliente corrija el pedido.
 * Abrir WhatsApp no permite comprobar si el cliente envió finalmente el mensaje.
 */
function resetOrder() {
    cart = [];
    save();
    $('#order-form').reset();
    $('#menu-screen').hidden = false;
    $('#order-screen').hidden = true;
    draw();
}
/**
 * Uso funcional de reduce para obtener un número a partir de varias líneas.
 * El acumulador comienza en cero y cada callback añade cantidad por precio en
 * centavos.
 * No modifica el carrito y siempre devuelve el mismo importe para el mismo
 * estado.
 * Es una estimación de presentación: el servidor revisará otra vez los precios
 * al continuar.
 */
function total() {
    return cart.reduce((n, i) => n + i.quantity * i.price_cents, 0);
}
/**
 * Representa el estado actual en tarjetas, líneas del pedido, importes y
 * botones.
 * map transforma productos y líneas en fragmentos HTML; join los reúne para
 * insertarlos en la pantalla.
 * Las cadenas del negocio se escapan antes de entrar a una plantilla.
 * La función mezcla transformaciones de datos con efectos sobre el DOM, por lo
 * que no es pura.
 * También mantiene coherentes los campos visibles y requeridos según la
 * modalidad de entrega.
 */
function draw() {
    $('#products').innerHTML = products.map(p => {
        const n = cart.find(i => i.id === p.id)?.quantity || 0;
        return `
            <article class="product">
                <div class="photo">
                    ${p.image_id ? `<img src="/media/${escape(p.image_id)}" alt="${escape(p.name)}" loading="lazy">` : 'Fotografía pendiente'}
                </div>
                <div class="product-content">
                    <h3>
                        ${escape(p.name)}
                    </h3>
                    <p class="muted">
                        ${escape(p.description)}
                    </p>
                    <div class="price-row">
                        <span class="price">
                            ${money(p.price_cents)}
                        </span>
                        <button class="button orange" data-add="${escape(p.id)}" aria-label="Agregar ${escape(p.name)}" ${n >= 99 ? 'disabled' : ''}>
                            Agregar +${n ? ' (' + n + ')' : ''}
                        </button>
                    </div>
                </div>
            </article>
        `;
    }).join('') || '<p>No hay productos disponibles por el momento.</p>';
    $('#order-lines').innerHTML = cart.map(i => {
        const p = products.find(p => p.id === i.id);
        if (!p) {
            return '';
        }
        return `
            <div class="order-line">
                <div>
                    <h3>
                        ${escape(p.name)}
                    </h3>
                    <p class="muted">
                        ${money(i.price_cents)} cada uno · ${money(i.quantity * i.price_cents)}
                    </p>
                </div>
                <div class="quantity">
                    <button type="button" class="button" data-minus="${escape(i.id)}" aria-label="Quitar uno de ${escape(p.name)}">
                        −
                    </button>
                    <span>
                        ${i.quantity}
                    </span>
                    <button type="button" class="button" data-add="${escape(i.id)}" aria-label="Agregar uno de ${escape(p.name)}" ${i.quantity >= 99 ? 'disabled' : ''}>
                        +
                    </button>
                </div>
            </div>
        `;
    }).join('') || '<p>Tu pedido está vacío. Agrega productos desde el menú.</p>';
    const count = cart.reduce((n, i) => n + i.quantity, 0);
    $('#cart-count').textContent = `${count} ${count === 1 ? 'producto' : 'productos'}`;
    $('#cart-subtotal').textContent = money(total());
    $('#order-total').textContent = money(total());
    $('#view-order').disabled = !cart.length;
    const delivery = $('#order-form').elements.delivery.value === 'delivery';
    $('#total-label').textContent = delivery ? 'Subtotal de productos' : 'Total';
    $('#pickup-address').textContent = delivery ? '' : settings.address ? `Recoge en: ${settings.address}` : 'Dirección de recogida pendiente de confirmar.';
    document.querySelectorAll('[data-delivery-field]').forEach(label => {
        label.hidden = !delivery;
        label.querySelector('input').disabled = !delivery;
    });
    const f = $('#order-form').elements;
    f.street.required = delivery;
    f.neighborhood.required = delivery;
    $('#status').textContent = online ? status.label : 'Sin conexión · No es posible enviar pedidos';
    $('#order-status').textContent = online ? status.label : 'Revisa tu conexión antes de continuar.';
    $('#checkout').disabled = busy || !online || !status.open || !cart.length || (!delivery && !settings.address);
    $('#checkout').textContent = busy ? 'Revisando pedido…' : 'Continuar a WhatsApp';
}
/**
 * Sincroniza el menú con la fuente compartida y vuelve a representar la
 * pantalla.
 * find busca el producto vigente de cada línea; filter retira los que dejaron
 * de estar disponibles.
 * Cuando cambia un precio se actualiza el objeto de la línea y se avisa al
 * cliente.
 * Aquí el callback de filter tiene efectos sobre los objetos: usar filter no
 * vuelve pura a toda la operación.
 * Si falla la conexión, se deshabilita el envío hasta poder comprobar de nuevo
 * el estado.
 */
async function refresh() {
    try {
        const data = await api('/api/menu');
        products = data.products;
        settings = data.settings;
        status = data.status;
        online = true;
        let changed = false;
        cart = cart.filter(i => {
            const p = products.find(p => p.id === i.id);
            if (!p) {
                changed = true;
                return false;
            }
            if (i.price_cents !== p.price_cents) {
                changed = true;
                i.price_cents = p.price_cents;
            }
            return true;
        });
        save();
        if (changed) {
            showNotice('El menú cambió. Actualizamos precios y disponibilidad; revisa tu pedido antes de continuar.');
        }
        $('#tagline').textContent = settings.tagline;
        document.querySelector('[data-business-name]').textContent = settings.name.toUpperCase();
        document.title = `${settings.name} · Menú`;
        $('#sample-label').hidden = settings.catalogConfirmed;
        $('#business-address').textContent = settings.address || 'Dirección pendiente de confirmar.';
        $('#map-link').hidden = !settings.mapUrl;
        if (settings.mapUrl) {
            $('#map-link').href = settings.mapUrl;
        }
        $('#logo').hidden = !settings.logoId;
        if (settings.logoId) {
            $('#logo').src = '/media/' + settings.logoId;
        }
        const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
        $('#business-hours').innerHTML = settings.scheduleReady ? `<ul>${settings.hours.map((h, i) => `<li>${days[i]}: ${h ? escape(h.open) + ' a ' + escape(h.close) : 'Sin servicio'}</li>`).join('')}</ul>` : 'Horario pendiente de confirmar.';
    }
    catch (e) {
        online = false;
        showNotice(e.message, true);
    }
    draw();
}
/**
 * Delegación de eventos: un solo listener atiende botones creados al redibujar
 * el menú.
 * closest encuentra el botón aunque el clic ocurra en un elemento situado
 * dentro de él.
 * El callback se ejecuta después del clic; no se llama al registrar el
 * listener.
 * Al disminuir una cantidad a cero, filter crea la lista sin esa línea.
 * Después se persiste el carrito y se actualiza la vista para reflejar el
 * cambio.
 */
document.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled) {
        return;
    }
    const id = b.dataset.add || b.dataset.minus;
    if (id) {
        let i = cart.find(i => i.id === id), p = products.find(p => p.id === id);
        if (!p) {
            return;
        }
        if (b.dataset.add) {
            if (i) {
                i.quantity = Math.min(99, i.quantity + 1);
            }
            else {
                cart.push({
                    id, quantity: 1, price_cents: p.price_cents
                });
            }
        }
        else if (i) {
            i.quantity--;
            cart = cart.filter(i => i.quantity > 0);
        }
        save();
        draw();
    }
});
/**
 * Muestra el pedido sin navegar a otra página ni perder el carrito en memoria.
 * El callback oculta el menú, muestra el formulario y solicita una
 * sincronización reciente.
 * La actualización puede avisar de precios o productos distintos de los vistos
 * al agregar.
 * Abrir esta pantalla no envía ningún mensaje a WhatsApp.
 */
$('#view-order').addEventListener('click', () => {
    $('#menu-screen').hidden = true;
    $('#order-screen').hidden = false;
    window.scrollTo({
        top: 0, behavior: 'smooth'
    });
    refresh();
});
$('#back-menu').addEventListener('click', () => {
    $('#menu-screen').hidden = false;
    $('#order-screen').hidden = true;
});
$('#order-form').elements.delivery.addEventListener('change', draw);
/**
 * Controla el paso desde el formulario hasta el mensaje preparado en WhatsApp.
 * preventDefault evita que el navegador recargue la página al enviar el
 * formulario.
 * busy bloquea envíos duplicados mientras se espera la revisión del servidor.
 * FormData lee solo campos habilitados, por lo que el domicilio oculto para
 * recogida no se envía.
 * Un conflicto actualiza el menú y exige revisar el pedido; nunca continúa con
 * un precio desactualizado.
 */
$('#order-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || !status.open || !online || !cart.length) {
        return;
    }
    busy = true;
    draw();
    showNotice('');
    try {
        const fields = Object.fromEntries(new FormData(e.target));
        const data = await api('/api/order', {
            method: 'POST', body: JSON.stringify({
                ...fields, items: cart
            })
        });
        resetOrder();
        window.location.assign(data.url);
    }
    catch (error) {
        if (error.refresh || error.status === 403) {
            await refresh();
        }
        showNotice(error.message, true);
        $('#notice').scrollIntoView({ block: 'center' });
    }
    finally {
        busy = false;
        draw();
    }
});
/**
 * Sincroniza al volver a la pestaña después de atender otra aplicación.
 * El listener solo consulta cuando el documento vuelve a estar visible.
 * Esto ayuda a reflejar cambios del administrador que ocurrieron mientras el
 * cliente estaba fuera.
 * La verificación definitiva sigue estando en el servidor, no en este evento.
 */
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        refresh();
    }
});
window.addEventListener('online', refresh);
window.addEventListener('offline', () => {
    online = false;
    draw();
});
/**
 * Actualización periódica ligera para una pestaña que permanece abierta.
 * La función flecha es un callback que el temporizador invoca cada minuto.
 * No consulta mientras la pestaña está oculta para reducir solicitudes
 * innecesarias.
 * Este intervalo mejora la información visual, pero no reemplaza la validación
 * al preparar el pedido.
 */
setInterval(() => {
    if (!document.hidden) {
        refresh();
    }
}, 60000);
refresh();
