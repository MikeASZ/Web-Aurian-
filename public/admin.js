/** Panel administrativo: cada cambio se valida y guarda mediante la API protegida. */
import { $, escape, money, api, showNotice, uploadImage } from './common.js';
let data = null;
let editing = null;
let deleting = null;
let busy = false;
const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const productForm = $('#product-form');
const settingsForm = $('#settings-form');
$('#hours').innerHTML = days.map((day, i) => `
    <div class="day">
        <label class="check">
            <input type="checkbox" name="day${i}">
            ${day}
        </label>
        <label>
            Apertura
            <input type="time" name="open${i}" aria-label="Apertura ${day}" disabled>
        </label>
        <label>
            Cierre
            <input type="time" name="close${i}" aria-label="Cierre ${day}" disabled>
        </label>
    </div>
`).join('');
/**
 * Centraliza la presentación de errores de las acciones administrativas.
 * Cuando la API responde 401, la sesión ya no permite operar y se vuelve al
 * formulario de acceso.
 * Otros errores conservan la pantalla para que el administrador corrija sus
 * datos.
 * No muestra detalles internos de la base ni los valores de las contraseñas.
 */
function authError(error) {
    showNotice(error.message, true);
    if (error.status === 401) {
        $('#login-screen').hidden = false;
        $('#admin-screen').hidden = true;
        data = null;
    }
}
/**
 * Mantiene una bandera compartida y deshabilita botones durante una acción
 * pendiente.
 * forEach recorre los botones y produce un efecto en cada elemento del DOM.
 * A diferencia de map, forEach no construye un arreglo de resultados para
 * usarlo después.
 * El bloqueo visual se combina con la bandera busy para evitar acciones
 * repetidas.
 */
function lock(yes) {
    busy = yes;
    document.querySelectorAll('#admin-screen button, #login-form button').forEach(b => b.disabled = yes);
}
/**
 * Función de orden superior: recibe otra función que describe la operación a
 * ejecutar.
 * La función recibida es un callback y puede ser asíncrona, por eso se espera
 * con await.
 * El patrón concentra manejo de errores y desbloqueo en un único lugar.
 * finally se ejecuta tanto al guardar correctamente como cuando la operación
 * falla.
 * Las funciones de los botones solo necesitan definir su operación particular.
 */
async function action(fn) {
    if (busy) {
        return;
    }
    lock(true);
    try {
        await fn();
    }
    catch (e) {
        authError(e);
    }
    finally {
        lock(false);
    }
}
/**
 * Transforma los productos recibidos en filas administrativas mediante map.
 * Cada callback devuelve HTML para un producto; join reúne las filas sin
 * separadores.
 * Los identificadores permiten que los botones señalen qué registro editar,
 * ocultar o eliminar.
 * Los textos del catálogo se escapan antes de insertarlos como HTML.
 * Mostrar una fila no cambia la base: las escrituras solo ocurren mediante las
 * acciones de la API.
 */
function drawProducts() {
    $('#product-count').textContent = `${data.products.length} productos${data.settings.catalogConfirmed ? '' : ' · Precios pendientes de confirmar'}`;
    $('#admin-list').innerHTML = data.products.map(p => `
        <article class="admin-row">
            <div class="admin-detail">
                <h3>
                    ${escape(p.name)}
                </h3>
                <p class="muted">
                    ${money(p.price_cents)} · Posición ${p.position}
                </p>
            </div>
            <span class="badge ${p.available ? '' : 'off'}">
                ${p.available ? 'Visible' : 'Oculto'}
            </span>
            <div class="actions">
                <button type="button" class="button" data-edit="${escape(p.id)}" aria-label="Editar ${escape(p.name)}">
                    Editar
                </button>
                <button type="button" class="button" data-toggle="${escape(p.id)}" aria-label="${p.available ? 'Ocultar' : 'Mostrar'} ${escape(p.name)}">
                    ${p.available ? 'Ocultar' : 'Mostrar'}
                </button>
                <button type="button" class="button" data-delete="${escape(p.id)}" aria-label="Eliminar ${escape(p.name)}">
                    Eliminar
                </button>
            </div>
        </article>
    `).join('') || '<p>No hay productos registrados.</p>';
}
/**
 * Rellena el formulario a partir de la configuración confirmada por el
 * servidor.
 * reset elimina selecciones de archivos o marcas de borrado que pertenecían a
 * una edición anterior.
 * Los bucles y forEach asignan valores a controles; son efectos deliberados
 * sobre el DOM.
 * Los días sin servicio quedan deshabilitados y no exigen horas de apertura o
 * cierre.
 */
function drawSettings() {
    const f = settingsForm.elements, s = data.settings;
    settingsForm.reset();
    for (const key of ['name', 'tagline', 'whatsapp', 'address', 'mapUrl']) {
        f[key].value = s[key];
    }
    for (const key of ['scheduleReady', 'catalogConfirmed', 'temporaryClosed']) {
        f[key].checked = s[key];
    }
    s.hours.forEach((day, i) => {
        f['day' + i].checked = !!day;
        f['open' + i].value = day?.open || '';
        f['close' + i].value = day?.close || '';
        hourEnabled(i);
    });
    $('#logo-image').hidden = !s.logoId;
    if (s.logoId) {
        $('#logo-image').src = '/media/' + s.logoId;
    }
}
/**
 * Carga productos, configuración y usuario desde la API autenticada.
 * includeSettings=false permite actualizar la lista sin borrar ajustes del
 * negocio aún no guardados.
 * Al cargar todo se limpian los campos de contraseña y se presenta el usuario
 * vigente.
 * La respuesta nunca contiene la contraseña personalizada ni su hash.
 */
async function load(includeSettings = true) {
    data = await api('/api/admin/data');
    $('#login-screen').hidden = true;
    $('#admin-screen').hidden = false;
    drawProducts();
    if (includeSettings) {
        drawSettings();
        $('#credentials-form').reset();
        $('#credentials-form').elements.username.value = data.username;
    }
}
/**
 * Sincroniza los controles de un día cuando se marca o desmarca que tiene
 * servicio.
 * La misma condición controla disabled y required para evitar formularios
 * imposibles de completar.
 * El índice coincide con el arreglo semanal de lunes a domingo.
 * La validación del servidor vuelve a comprobar los intervalos al guardar.
 */
function hourEnabled(i) {
    const f = settingsForm.elements, enabled = f['day' + i].checked;
    for (const part of ['open', 'close']) {
        f[part + i].disabled = !enabled;
        f[part + i].required = enabled;
    }
}
/**
 * Devuelve al listado después de cancelar o guardar un producto.
 * Retira la referencia editing para que la siguiente alta no reutilice el
 * identificador anterior.
 * Cambiar esta referencia modifica el estado del módulo, no elimina registros
 * de la base.
 * Cancelar un formulario no ejecuta una petición de escritura.
 */
function closeEditor() {
    editing = null;
    productForm.hidden = true;
    $('#catalog').hidden = false;
}
/**
 * Prepara un único formulario para crear un producto o editar uno existente.
 * find busca el registro; si no existe, los valores iniciales corresponden a
 * una alta.
 * editing conserva la revisión recibida para detectar cambios simultáneos al
 * guardar.
 * Las fotos existentes se muestran por su URL y no se vuelven a subir si no se
 * elige otro archivo.
 */
function editProduct(id) {
    showNotice('');
    editing = data.products.find(p => p.id === id) || null;
    const p = editing, f = productForm.elements;
    productForm.reset();
    f.name.value = p?.name || '';
    f.price.value = p ? (p.price_cents / 100).toFixed(2) : '';
    f.position.value = p?.position || Math.max(0, ...data.products.map(p => p.position)) + 1;
    f.description.value = p?.description || '';
    f.available.checked = p ? !!p.available : true;
    $('#editor-title').textContent = p ? 'Editar producto' : 'Nuevo producto';
    $('#product-image').hidden = !p?.image_id;
    if (p?.image_id) {
        $('#product-image').src = '/media/' + p.image_id;
    }
    $('#catalog').hidden = true;
    productForm.hidden = false;
    f.name.focus();
}
/**
 * El listener del acceso captura el envío del formulario y delega el trabajo
 * en action.
 * Solo envía usuario y contraseña a la ruta de autenticación del mismo origen.
 * Después de entrar limpia la contraseña del formulario y carga el panel.
 * La cookie de sesión se gestiona por HTTP; el código no copia el token a
 * localStorage.
 */
$('#login-form').addEventListener('submit', e => {
    e.preventDefault();
    action(async () => {
        const f = e.target.elements;
        await api('/api/login', {
            method: 'POST', body: JSON.stringify({
                username: f.username.value, password: f.password.value
            })
        });
        f.password.value = '';
        await load();
        showNotice('');
    });
});
/**
 * Cierra la sesión en el servidor y devuelve la interfaz al acceso.
 * La API elimina el hash del token, de modo que retirar solo la pantalla no es
 * la única protección.
 * La función flecha entrega el callback a action sin ejecutarlo durante la
 * carga de la página.
 * Cerrar sesión no cambia productos, configuración ni credenciales.
 */
$('#logout').addEventListener('click', () => action(async () => {
    await api('/api/admin/logout', {
        method: 'POST', body: '{}'
    });
    data = null;
    $('#admin-screen').hidden = true;
    $('#login-screen').hidden = false;
    showNotice('Sesión cerrada.');
}));
/**
 * Cada pestaña registra un callback que selecciona su panel relacionado.
 * forEach instala los listeners; el cuerpo del listener se ejecuta solo cuando
 * se hace clic.
 * aria-selected refleja la pestaña activa para herramientas de accesibilidad.
 * Cambiar de pestaña altera la presentación, no guarda automáticamente los
 * formularios.
 */
document.querySelectorAll('[role=tab]').forEach(tab => tab.addEventListener('click', () => {
    if (busy) {
        return;
    }
    document.querySelectorAll('[role=tab]').forEach(t => t.setAttribute('aria-selected', String(t === tab)));
    document.querySelectorAll('[role=tabpanel]').forEach(p => p.hidden = p.id !== tab.getAttribute('aria-controls'));
    showNotice('');
}));
$('#new-product').addEventListener('click', () => editProduct(null));
$('#cancel-product').addEventListener('click', closeEditor);
$('#reload-products').addEventListener('click', () => action(async () => {
    await load(false);
    showNotice('Lista actualizada.');
}));
/**
 * Un listener del listado atiende las filas que map crea dinámicamente.
 * Editar solo prepara un formulario; mostrar u ocultar realiza una escritura
 * con la revisión vigente.
 * Eliminar abre primero un diálogo de confirmación y conserva el producto
 * seleccionado.
 * La confirmación permite distinguir una baja definitiva de una
 * indisponibilidad temporal.
 */
$('#admin-list').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || busy) {
        return;
    }
    if (b.dataset.edit) {
        editProduct(b.dataset.edit);
    }
    if (b.dataset.toggle) {
        action(async () => {
            const p = data.products.find(p => p.id === b.dataset.toggle);
            await api('/api/admin/products/' + p.id, {
                method: 'PUT', body: JSON.stringify({
                    ...p, available: !p.available
                })
            });
            await load(false);
            showNotice('Disponibilidad actualizada.');
        });
    }
    if (b.dataset.delete) {
        deleting = data.products.find(p => p.id === b.dataset.delete);
        $('#delete-text').textContent = `¿Eliminar «${deleting.name}» del menú? Puedes ocultarlo si solo está agotado temporalmente.`;
        $('#delete-dialog').showModal();
    }
});
$('#cancel-delete').addEventListener('click', () => $('#delete-dialog').close());
/**
 * Ejecuta la eliminación que el administrador confirmó en el diálogo.
 * Envía la revisión del producto para que una ficha antigua no borre un
 * registro modificado por otra sesión.
 * Solo cierra el diálogo y recarga la lista cuando la API confirma la
 * operación.
 * finally rehabilita el botón si la petición falla y el administrador necesita
 * volver a intentarlo.
 */
$('#confirm-delete').addEventListener('click', () => action(async () => {
    if (!deleting) {
        return;
    }
    $('#confirm-delete').disabled = true;
    try {
        await api('/api/admin/products/' + deleting.id, {
            method: 'DELETE', body: JSON.stringify({ revision: deleting.revision })
        });
        $('#delete-dialog').close();
        deleting = null;
        await load(false);
        showNotice('Producto eliminado.');
    }
    finally {
        $('#confirm-delete').disabled = false;
    }
}));
/**
 * Guarda una alta o una edición utilizando el mismo formulario.
 * La foto se sube únicamente si se seleccionó un archivo nuevo; quitarla envía
 * una referencia null.
 * El precio visual se convierte a centavos y el servidor vuelve a comprobar
 * sus límites.
 * La elección POST o PUT depende de editing y determina si se crea o se
 * actualiza un registro.
 * Solo se vuelve al listado después de recibir una confirmación del servidor.
 */
productForm.addEventListener('submit', e => {
    e.preventDefault();
    action(async () => {
        const f = productForm.elements;
        let image_id = f.removePhoto.checked ? null : editing?.image_id || null;
        if (f.photo.files[0]) {
            image_id = await uploadImage(f.photo.files[0]);
        }
        const price = Number(f.price.value);
        const input = {
            name: f.name.value.trim(), description: f.description.value.trim(), price_cents: Math.round(price * 100), position: Number(f.position.value), available: f.available.checked, image_id, ...(editing ? { revision: editing.revision } : {})
        };
        await api('/api/admin/products' + (editing ? '/' + editing.id : ''), {
            method: editing ? 'PUT' : 'POST', body: JSON.stringify(input)
        });
        closeEditor();
        await load(false);
        showNotice('Producto guardado. Los clientes verán el cambio al consultar el menú.');
    });
});
settingsForm.addEventListener('change', e => {
    const match = e.target.name.match(/^day([0-6])$/);
    if (match) {
        hourEnabled(+match[1]);
    }
});
/**
 * Construye una configuración nueva a partir de los controles del negocio.
 * Object.fromEntries convierte pares clave-valor en objetos para no repetir
 * asignaciones de campos.
 * map genera los siete días del horario: cada día es un intervalo o null si no
 * tiene servicio.
 * La revisión de la configuración viaja con la petición para detectar
 * ediciones simultáneas.
 * La compresión y carga del logo preceden al guardado de su referencia.
 */
settingsForm.addEventListener('submit', e => {
    e.preventDefault();
    action(async () => {
        const f = settingsForm.elements;
        let logoId = f.removeLogo.checked ? null : data.settings.logoId;
        if (f.logo.files[0]) {
            logoId = await uploadImage(f.logo.files[0]);
        }
        const settings = {
            ...Object.fromEntries(['name', 'tagline', 'whatsapp', 'address', 'mapUrl'].map(key => [key, f[key].value])), ...Object.fromEntries(['scheduleReady', 'catalogConfirmed', 'temporaryClosed'].map(key => [key, f[key].checked])), hours: days.map((_, i) => f['day' + i].checked ? {
                open: f['open' + i].value, close: f['close' + i].value
            } : null), logoId, revision: data.revision
        };
        await api('/api/admin/settings', {
            method: 'PUT', body: JSON.stringify(settings)
        });
        await load();
        showNotice('Configuración guardada.');
    });
});
/**
 * Comprueba la confirmación de contraseña antes de solicitar el cambio de
 * acceso.
 * El servidor valida otra vez la coincidencia y exige la contraseña actual.
 * Después del cambio, reset borra los campos sensibles y la sesión queda
 * cerrada.
 * Solo se conserva el usuario nuevo en el formulario de entrada para facilitar
 * el siguiente acceso.
 * La contraseña no se guarda en el navegador ni se muestra en una
 * notificación.
 */
$('#credentials-form').addEventListener('submit', e => {
    e.preventDefault();
    action(async () => {
        const f = e.target.elements;
        if (f.newPassword.value !== f.confirmPassword.value) {
            showNotice('La confirmación no coincide con la contraseña nueva.', true);
            f.confirmPassword.focus();
            return;
        }
        const result = await api('/api/admin/credentials', {
            method: 'PUT', body: JSON.stringify({
                username: f.username.value, currentPassword: f.currentPassword.value, newPassword: f.newPassword.value, confirmPassword: f.confirmPassword.value
            })
        });
        e.target.reset();
        $('#login-form').reset();
        $('#login-form').elements.username.value = result.username;
        data = null;
        $('#admin-screen').hidden = true;
        $('#login-screen').hidden = false;
        showNotice('Acceso actualizado. Inicia sesión con tu nuevo usuario y contraseña.');
        $('#login-form').elements.password.focus();
    });
});
load().catch(e => {
    if (e.status !== 401) {
        authError(e);
    }
});
