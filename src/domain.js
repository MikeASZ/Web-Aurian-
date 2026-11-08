/**
 * Error esperado por una regla del negocio, distinto de un fallo interno.
 * status indica el estado HTTP que usará la API; message es el aviso que verá
 * el usuario.
 * detail permite solicitar una actualización del menú mediante refresh, sin
 * acoplar la regla a una pantalla concreta.
 * La clase no envía respuestas por sí misma: worker.js decide cómo representar
 * el error.
 */
export class HttpError extends Error {
    constructor(status, message, detail = {}) {
        super(message);
        this.status = status;
        this.detail = detail;
    }
}
/**
 * Normaliza entradas de formularios sin acceder a la base ni al navegador.
 * value es el texto recibido; max limita campos del negocio y required
 * distingue campos obligatorios.
 * Devuelve una cadena sin espacios externos ni caracteres de control que no
 * deben aparecer en el mensaje.
 * Es una función pura: para los mismos argumentos devuelve el mismo resultado
 * o el mismo tipo de error.
 * No se utiliza para contraseñas, porque recortar sus espacios cambiaría el
 * secreto elegido.
 */
export function text(value, max, required = false) {
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
        throw new HttpError(400, 'Revisa los campos del formulario.');
    }
    return value.trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}
/**
 * Recibe un objeto sin confiar en las validaciones del formulario HTML.
 * Valida nombre, precio, posición y disponibilidad antes de crear un objeto
 * con los campos permitidos.
 * price_cents expresa centavos: 11000 equivale a 110 pesos y evita sumar
 * cantidades monetarias con decimales binarios.
 * No guarda nada. El controlador utiliza el resultado para una consulta SQL
 * parametrizada.
 * Una presentación diferente se registra como otro producto; aquí no hay
 * categorías ni variantes.
 */
export function productInput(v) {
    const name = text(v.name, 80, true), description = text(v.description ?? '', 400);
    if (!Number.isInteger(v.price_cents) || v.price_cents < 1 || v.price_cents > 9999900) {
        throw new HttpError(400, 'El precio debe ser mayor que cero y tener como máximo dos decimales.');
    }
    if (!Number.isInteger(v.position) || v.position < 1 || v.position > 999 || typeof v.available !== 'boolean') {
        throw new HttpError(400, 'Revisa el orden y la disponibilidad.');
    }
    return {
        name, description, price_cents: v.price_cents, position: v.position, available: v.available, image_id: v.image_id || null
    };
}
/**
 * Construye una configuración nueva a partir de valores enviados por el
 * administrador.
 * Restringe la ubicación a HTTPS, normaliza el teléfono mexicano y fija la
 * zona horaria del negocio.
 * El arreglo hours tiene siete posiciones, de lunes a domingo; null representa
 * un día sin servicio.
 * Solo devuelve campos conocidos, para que el cliente no introduzca
 * propiedades arbitrarias en la configuración.
 * No consulta la fecha actual ni modifica el objeto recibido: separa
 * validación de persistencia.
 */
export function settingsInput(v) {
    const name = text(v.name, 80, true), tagline = text(v.tagline ?? '', 140), address = text(v.address ?? '', 400);
    const whatsapp = text(v.whatsapp ?? '', 20).replace(/[\s()+-]/g, '');
    if (whatsapp && !/^52\d{10}$/.test(whatsapp)) {
        throw new HttpError(400, 'Usa el código 52 seguido de los 10 dígitos del WhatsApp.');
    }
    const mapUrl = text(v.mapUrl ?? '', 500);
    if (mapUrl) {
        try {
            if (new URL(mapUrl).protocol !== 'https:') {
                throw new Error();
            }
        }
        catch {
            throw new HttpError(400, 'El enlace de ubicación debe comenzar con https://.');
        }
    }
    if (!Array.isArray(v.hours) || v.hours.length !== 7) {
        throw new HttpError(400, 'Configura los siete días de la semana.');
    }
/**
 * Uso funcional de map: transforma cada día recibido en un intervalo validado
 * o null.
 * El callback es la función que map ejecuta una vez por cada elemento y
 * devuelve el valor de esa posición.
 * map crea otro arreglo; aquí no cambia el arreglo original ni escribe en la
 * base.
 * Si un día tiene un intervalo inválido, el callback lanza un error y se
 * rechaza toda la configuración.
 */
    const hours = v.hours.map(day => {
        if (day === null) {
            return null;
        }
        if (!day || !/^([01]\d|2[0-3]):[0-5]\d$/.test(day.open) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(day.close) || day.close <= day.open) {
            throw new HttpError(400, 'El cierre debe ser posterior a la apertura del mismo día.');
        }
        return {
            open: day.open, close: day.close
        };
    });
    const scheduleReady = v.scheduleReady === true, catalogConfirmed = v.catalogConfirmed === true;
    if (scheduleReady && !hours.some(Boolean)) {
        throw new HttpError(400, 'Selecciona al menos un día con servicio.');
    }
    return {
        name, tagline, address, whatsapp, mapUrl, logoId: v.logoId || null, timezone: 'America/Mexico_City', scheduleReady, catalogConfirmed, temporaryClosed: v.temporaryClosed === true, hours
    };
}
/**
 * Determina si se pueden preparar pedidos con la configuración y la fecha
 * indicadas.
 * Los bloqueos manuales y los datos pendientes tienen prioridad sobre los
 * intervalos semanales.
 * Recibir date como argumento permite probar horas exactas sin depender del
 * reloj del equipo.
 * Con argumentos explícitos es determinista; si se omite date, el valor por
 * defecto consulta la hora actual.
 * Devuelve open para la lógica y label para mostrar el motivo de apertura o
 * cierre al cliente.
 */
export function operatingStatus(settings, date = new Date()) {
    if (settings.temporaryClosed) {
        return {
            open: false, label: 'Pedidos suspendidos temporalmente'
        };
    }
    if (!settings.scheduleReady) {
        return {
            open: false, label: 'Horario pendiente · Pedidos no disponibles'
        };
    }
    if (!settings.catalogConfirmed || !/^52\d{10}$/.test(settings.whatsapp)) {
        return {
            open: false, label: 'Pedidos no disponibles por el momento'
        };
    }
/**
 * formatToParts entrega pares del calendario de CDMX, aunque el servidor esté
 * en otra región.
 * map convierte cada pieza en [tipo, valor]; Object.fromEntries reúne esos
 * pares en un objeto consultable.
 * Así hour y minute se obtienen por nombre, sin depender del orden visual de
 * una fecha traducida.
 * La comparación HH:mm es válida porque horas y minutos tienen siempre dos
 * dígitos.
 */
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Mexico_City', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(date).map(p => [p.type, p.value]));
    const today = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday), time = `${parts.hour}:${parts.minute}`, hours = settings.hours;
    const current = hours[today];
    if (current && time >= current.open && time < current.close) {
        return {
            open: true, label: `Abierto · Cerramos a las ${current.close}`
        };
    }
    const names = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
/**
 * El recorrido busca la siguiente apertura, incluida la del mismo día si aún
 * no comienza.
 * El módulo siete permite pasar del domingo al lunes sin salir del arreglo.
 * Se incluye offset=7 para encontrar la siguiente semana cuando el único día
 * abierto ya cerró hoy.
 * Es un bucle imperativo con retorno temprano: no todo el proyecto usa
 * programación funcional.
 */
    for (let offset = 0; offset <= 7; offset++) {
        const day = (today + offset) % 7, h = hours[day];
        if (h && (offset > 0 || time < h.open)) {
            return {
                open: false, label: `Cerrado · Abrimos ${offset === 0 ? 'hoy' : offset === 1 ? 'mañana' : 'el ' + names[day]} a las ${h.open}`
            };
        }
    }
    return {
        open: false, label: 'Cerrado'
    };
}
/**
 * Valida el contenido del carrito y los datos personales solo para preparar el
 * mensaje.
 * Rechaza productos repetidos, cantidades fuera del rango permitido y
 * modalidades de entrega desconocidas.
 * El Set seen pertenece únicamente a esta llamada; sirve para detectar
 * identificadores duplicados.
 * El resultado no se inserta en ninguna tabla de pedidos o clientes.
 * Para recogida se omiten los campos del domicilio aunque el navegador enviara
 * valores antiguos.
 */
export function orderInput(v) {
    if (!Array.isArray(v.items) || !v.items.length || v.items.length > 50) {
        throw new HttpError(400, 'Agrega productos a tu pedido.');
    }
    const seen = new Set();
/**
 * map crea una lista nueva con los campos admitidos de cada línea del pedido.
 * El callback usa el Set local para detectar duplicados; por eso esta
 * transformación no es completamente pura.
 * Cada resultado conserva el precio que vio el cliente para compararlo después
 * con el precio vigente.
 * Ese precio enviado no es una fuente de confianza para calcular el cobro.
 */
    const items = v.items.map(i => {
        if (!i || typeof i.id !== 'string' || i.id.length > 80 || seen.has(i.id) || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 99 || !Number.isInteger(i.price_cents)) {
            throw new HttpError(400, 'Revisa las cantidades del pedido.');
        }
        seen.add(i.id);
        return {
            id: i.id, quantity: i.quantity, price_cents: i.price_cents
        };
    });
    if (!['pickup', 'delivery'].includes(v.delivery)) {
        throw new HttpError(400, 'Selecciona una modalidad de entrega.');
    }
    const name = text(v.name, 80, true), notes = text(v.notes ?? '', 300);
    const address = v.delivery === 'delivery' ? {
        street: text(v.street, 160, true), neighborhood: text(v.neighborhood, 100, true), reference: text(v.reference ?? '', 200)
    } : {};
    return {
        items, name, notes, delivery: v.delivery, ...address
    };
}
/**
 * Función flecha: recibe centavos y devuelve una cadena con formato monetario
 * mexicano.
 * No altera el importe almacenado; la división entre cien solo ocurre para
 * presentarlo.
 * La sintaxis cents => expresión equivale a una función que retorna
 * directamente esa expresión.
 * Esta utilidad evita repetir reglas de presentación en las líneas del
 * mensaje.
 */
export const money = cents => new Intl.NumberFormat('es-MX', {
    style: 'currency', currency: 'MXN'
}).format(cents / 100);
/**
 * Prepara el texto y el enlace de WhatsApp a partir de entradas ya validadas.
 * Busca cada producto en el catálogo vigente y exige que conserve
 * disponibilidad y precio.
 * Si algo cambió, el error 409 solicita que la interfaz actualice el menú
 * antes de continuar.
 * No envía el mensaje: el cliente aún debe revisar y pulsar Enviar dentro de
 * WhatsApp.
 * Para domicilio usa Subtotal de productos y no calcula ni menciona un cargo
 * de envío.
 */
export function buildOrder(order, products, settings) {
    let total = 0;
/**
 * map convierte las líneas del carrito en líneas legibles del mensaje.
 * find localiza el producto que corresponde al identificador y debe estar
 * disponible.
 * La cantidad se multiplica por el precio del servidor, nunca por un total
 * calculado en el navegador.
 * El callback también incrementa total: es una acumulación local con efectos,
 * no una transformación pura.
 * Ese efecto no sale de la función ni modifica los productos o el pedido
 * recibidos.
 */
    const lines = order.items.map(item => {
        const product = products.find(p => p.id === item.id && p.available);
        if (!product) {
            throw new HttpError(409, 'Un producto ya no está disponible. Actualizamos el menú; revisa tu pedido.', { refresh: true });
        }
        if (product.price_cents !== item.price_cents) {
            throw new HttpError(409, 'Cambió un precio. Actualizamos el menú; revisa el nuevo importe antes de continuar.', { refresh: true });
        }
        const subtotal = product.price_cents * item.quantity;
        total += subtotal;
        return `${item.quantity} × ${product.name} (${money(product.price_cents)}) = ${money(subtotal)}`;
    });
    const label = order.delivery === 'delivery' ? 'Subtotal de productos' : 'Total';
    const message = [`Hola, ${settings.name}. Quiero hacer un pedido:`, '', ...lines, '', `${label}: ${money(total)}`, `Nombre: ${order.name}`, `Modalidad: ${order.delivery === 'delivery' ? 'Entrega a domicilio' : 'Recoger en el negocio'}`, ...(order.delivery === 'delivery' ? [`Dirección: ${order.street}`, `Colonia: ${order.neighborhood}`, ...(order.reference ? [`Referencias: ${order.reference}`] : [])] : []), ...(order.notes ? [`Observaciones: ${order.notes}`] : [])].join('\n');
    return {
        total_cents: total, message, url: `https://wa.me/${settings.whatsapp}?text=${encodeURIComponent(message)}`
    };
}
