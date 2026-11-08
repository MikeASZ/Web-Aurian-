/**
 * Atajo para obtener el primer elemento que coincide con un selector del
 * documento.
 * Es una función flecha de una expresión y retorna directamente querySelector.
 * Lee el DOM actual, por lo que el resultado depende del estado de la página.
 * Los selectores utilizados deben existir en la pantalla que importa esta
 * utilidad.
 */
export const $ = selector => document.querySelector(selector);
/**
 * Escapa caracteres que tienen significado al construir HTML desde datos del
 * negocio.
 * replace recibe un callback que elige la entidad adecuada para cada carácter
 * encontrado.
 * El objeto funciona como tabla de equivalencias y evita una cadena de
 * condicionales.
 * Devuelve texto nuevo; no modifica el valor original ni inserta contenido en
 * el DOM.
 */
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
/**
 * Presenta centavos como pesos con formato mexicano y dos posiciones
 * monetarias.
 * El catálogo y el carrito conservan enteros; solo la salida visual se divide
 * entre cien.
 * La función se puede reutilizar al renderizar tarjetas, subtotales y el
 * total.
 * No calcula cobros ni sustituye la validación del servidor.
 */
export const money = cents => new Intl.NumberFormat('es-MX', {
    style: 'currency', currency: 'MXN'
}).format(cents / 100);
/**
 * Unifica las llamadas HTTP para el cliente y el administrador.
 * Incluye cookies del mismo origen y evita reutilizar respuestas antiguas de
 * la API.
 * Solo agrega Content-Type JSON cuando el cuerpo es texto; las fotos conservan
 * su tipo binario.
 * Un error conserva status y refresh para que cada pantalla decida si debe
 * volver al acceso o recargar el menú.
 * fetch realiza entrada/salida; esta función no es pura aunque sus opciones se
 * construyan con objetos nuevos.
 */
export async function api(path, options = {}) {
    let response;
    try {
        response = await fetch(path, {
            credentials: 'same-origin', cache: 'no-store', ...options, headers: {
                ...(options.body && typeof options.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...options.headers
            }
        });
    }
    catch {
        throw new Error('No se pudo conectar. Revisa tu conexión e intenta de nuevo.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.error || 'No se pudo completar la solicitud.');
        error.status = response.status;
        error.refresh = data.refresh;
        throw error;
    }
    return data;
}
/**
 * Actualiza el aviso compartido sin interpretar el mensaje como HTML.
 * textContent presenta texto seguro y classList distingue errores de
 * notificaciones normales.
 * La propiedad hidden retira el aviso cuando no hay mensaje.
 * Esta función modifica el DOM: su efecto es visible en la página.
 */
export function showNotice(message, error = false) {
    const el = $('#notice');
    el.textContent = message;
    el.classList.toggle('error', error);
    el.hidden = !message;
}
/**
 * Prepara un archivo para el catálogo pequeño sin subir la imagen original
 * completa.
 * Comprueba formato y tamaño de entrada, calcula una escala y dibuja en un
 * canvas temporal.
 * Prueba varias calidades WebP hasta cumplir el límite de almacenamiento del
 * servidor.
 * La promesa permite esperar a toBlob, cuya API entrega el resultado mediante
 * un callback.
 * Libera el bitmap después de dibujarlo para no conservar memoria innecesaria.
 */
export async function compressImage(file) {
    if (!file) {
        return null;
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) {
        throw new Error('Selecciona una imagen PNG, JPEG o WebP de hasta 12 MB.');
    }
    let image;
    try {
        image = await createImageBitmap(file);
    }
    catch {
        throw new Error('No se pudo leer la imagen. Prueba con otro archivo.');
    }
    const scale = Math.min(1, 900 / Math.max(image.width, image.height)), canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    for (const quality of [.82, .65, .45, .25]) {
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
        if (blob && blob.size <= 180 * 1024) {
            return blob;
        }
    }
    throw new Error('La imagen sigue siendo muy grande. Selecciona una de menor tamaño.');
}
/**
 * Coordina compresión y envío binario de una foto seleccionada por el
 * administrador.
 * Si no hay archivo, devuelve null y el formulario puede conservar la imagen
 * anterior.
 * Devuelve únicamente el identificador que luego se asocia al producto o al
 * logo.
 * Subir la foto y guardar el formulario son operaciones separadas: el plazo de
 * limpieza protege ese intervalo.
 */
export async function uploadImage(file) {
    const blob = await compressImage(file);
    if (!blob) {
        return null;
    }
    return (await api('/api/admin/media', {
        method: 'POST', body: blob, headers: { 'Content-Type': blob.type }
    })).id;
}
