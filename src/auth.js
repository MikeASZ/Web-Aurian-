/** Credenciales y límites de intentos compartidos por el servidor local y Cloudflare. */
const encoder = new TextEncoder();
/**
 * Convierte bytes a texto hexadecimal para guardar tokens y hashes en columnas
 * de texto.
 * Array.from crea un arreglo nuevo y ejecuta un callback que representa cada
 * byte con dos dígitos.
 * join reúne las piezas sin separador; ningún byte del arreglo recibido se
 * modifica.
 * Esta transformación no cifra información: hexadecimal es solamente una
 * representación.
 */
export const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
/**
 * Devuelve SHA-256 como texto hexadecimal mediante la API criptográfica del
 * entorno.
 * async indica que la función entrega una promesa; await espera el resultado
 * sin bloquear con un bucle manual.
 * Se usa para identificadores de sesiones e intentos, y para compatibilidad
 * con el acceso inicial aleatorio.
 * Las contraseñas personalizadas pasan por passwordHash, que incorpora
 * derivación y secretos adicionales.
 */
export async function digest(value) {
    return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}
/**
 * Compara cadenas de hash del mismo tamaño acumulando las diferencias.
 * No termina al encontrar el primer carácter distinto, evitando una
 * comparación con retornos por posición.
 * El bucle y el acumulador son estado local; la función no modifica sus
 * argumentos.
 * La comprobación inicial de tamaño es válida porque se comparan
 * representaciones de hashes conocidas.
 */
export function equal(a, b) {
    if (a.length !== b.length) {
        return false;
    }
    let result = 0;
    for (let i = 0; i < a.length; i++) {
        result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
}
/**
 * Consulta el único registro de credenciales personalizadas del negocio.
 * La base contiene el usuario, el hash, el salt y una revisión, pero no la
 * contraseña nueva en texto claro.
 * Si aún no hay registro devuelve null y la autenticación conserva el acceso
 * inicial generado localmente.
 * Es una operación con efectos de entrada/salida; no debe confundirse con una
 * función pura.
 */
export async function credentials(env) {
    return env.DB.prepare('SELECT * FROM admin_credentials WHERE id=1').first();
}
// El secreto inicial se conserva fuera de la base y actúa como pepper.
// HMAC protege la entrada antes de derivar el hash con un salt aleatorio.
// El coste de PBKDF2 respeta el límite de 100 000 iteraciones de Workers.
/**
 * Deriva el valor que se almacenará al personalizar la contraseña.
 * Primero combina la contraseña con un pepper secreto mediante HMAC; luego
 * aplica PBKDF2 con salt.
 * El salt cambia en cada modificación y puede guardarse en la base; el pepper
 * permanece en el entorno privado.
 * La misma contraseña con otro salt produce otro hash. La contraseña no se
 * puede consultar desde el panel.
 * La función devuelve una promesa y no escribe el registro: el controlador
 * guarda el resultado.
 */
export async function passwordHash(password, salt, pepper) {
    const hmac = await crypto.subtle.importKey('raw', encoder.encode(pepper), {
        name: 'HMAC', hash: 'SHA-256'
    }, false, ['sign']);
    const input = await crypto.subtle.sign('HMAC', hmac, encoder.encode(password));
    const key = await crypto.subtle.importKey('raw', input, 'PBKDF2', false, ['deriveBits']);
    return hex(await crypto.subtle.deriveBits({
        name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations: 100000
    }, key, 256));
}
/**
 * Selecciona el mecanismo de verificación según exista o no un acceso
 * personalizado.
 * Si existe un registro, deriva de nuevo el hash con su salt y el secreto del
 * servidor.
 * Si no existe, compara con el hash del acceso aleatorio inicial para permitir
 * la primera entrada.
 * No impone longitud a la contraseña; sí exige una cadena no vacía y un
 * secreto configurado.
 * Retorna true o false sin devolver al cliente ninguno de los hashes
 * utilizados.
 */
export async function verifyPassword(password, record, env) {
    if (typeof password !== 'string' || !password || !env.ADMIN_PASSWORD_SHA256) {
        return false;
    }
    return record ? equal(await passwordHash(password, record.salt, env.ADMIN_PASSWORD_SHA256), record.password_hash) : equal(await digest(password), env.ADMIN_PASSWORD_SHA256);
}
/**
 * Registra un intento y devuelve el contador vigente para la clave recibida.
 * La clave distingue los intentos de acceso de los intentos de cambiar
 * credenciales.
 * Primero elimina ventanas vencidas; el INSERT con conflicto incrementa dentro
 * de la propia base.
 * La operación atómica evita leer un contador viejo cuando llegan peticiones
 * al mismo tiempo.
 * El controlador decide cuándo bloquear o reiniciar el contador tras una
 * operación correcta.
 */
export async function attempt(db, key, now = Date.now()) {
    await db.prepare('DELETE FROM login_limits WHERE reset_at <= ?').bind(now).run();
    return db.prepare('INSERT INTO login_limits(ip_hash,attempts,reset_at) VALUES(?,1,?) ON CONFLICT(ip_hash) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(key, now + 15 * 60000).first();
}
