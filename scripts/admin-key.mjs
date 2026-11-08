/** Generación del acceso inicial y consulta del usuario administrador local. */
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createDatabase, backupBeforeMigrations } from './sqlite-adapter.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = path.join(root, '.local');
const accessFile = path.join(directory, 'access.json');

/**
 * Prepara una sola vez el acceso aleatorio de la instalación local.
 * Si access.json ya existe, lo lee sin reemplazar el secreto de arranque.
 * Ese secreto sigue siendo necesario después de personalizar el usuario y la
 * contraseña desde el panel.
 * La función devuelve los valores al servidor, pero importarla no debe
 * imprimirlos.
 * Los archivos se ubican en .local, que está excluido del repositorio.
 */
export function localAccess() {
    mkdirSync(directory, { recursive: true });

    if (!existsSync(accessFile)) {
        const generated = {
            username: 'administrador',
            password: randomBytes(24).toString('base64url'),
        };
        writeFileSync(accessFile, JSON.stringify(generated, null, 4), { mode: 0o600 });
    }

    const credentials = JSON.parse(readFileSync(accessFile, 'utf8'));
    return {
        credentials,
        env: {
            ADMIN_USERNAME: credentials.username,
            ADMIN_PASSWORD_SHA256: createHash('sha256').update(credentials.password).digest('hex'),
        },
    };
}

/**
 * Consulta únicamente el nombre del acceso personalizado cuando existe una
 * base local.
 * Antes de aplicar migraciones pendientes solicita un respaldo consistente de
 * SQLite.
 * La conexión se libera en finally para cubrir tanto un resultado válido como
 * una excepción.
 * No obtiene ni intenta reconstruir una contraseña a partir de su hash.
 */
async function currentUsername() {
    const databasePath = path.join(directory, 'aurian.db');
    if (!existsSync(databasePath)) {
        return null;
    }

    await backupBeforeMigrations(databasePath);
    const database = createDatabase(databasePath);
    try {
        const account = await database.prepare('SELECT username FROM admin_credentials WHERE id=1').first();
        return account?.username || null;
    } finally {
        // Liberar la conexión una sola vez, incluso cuando falla la consulta.
        database.close();
    }
}

/**
 * Convierte las variables privadas de arranque al formato del archivo
 * .dev.vars.
 * Object.entries crea pares; map transforma cada par en una asignación y join
 * reúne las líneas.
 * La transformación no cambia env, aunque writeFileSync sí escribe un archivo
 * privado.
 * El resultado debe conservarse con la instalación y no publicarse en GitHub.
 */
function exportSecrets(env) {
    const content = Object.entries(env)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join('\n');

    writeFileSync(path.join(root, '.dev.vars'), content + '\n', { mode: 0o600 });
    console.log('Secretos de arranque exportados a .dev.vars. Conserva estos secretos al trasladar la base.');
}

/**
 * Coordina la consulta del acceso desde la terminal, separada de las funciones
 * reutilizables.
 * --show consulta sin volver a exportar secretos; sin esa opción se prepara
 * .dev.vars.
 * Cuando hay acceso personalizado, informa solo del usuario porque su
 * contraseña ya no es recuperable.
 * El retorno temprano evita presentar por error la contraseña inicial como si
 * siguiera vigente.
 */
async function main() {
    const { credentials, env } = localAccess();
    const username = await currentUsername();

    if (!process.argv.includes('--show')) {
        exportSecrets(env);
    }

    if (username) {
        // El acceso inicial ya no es válido: no mostrar su contraseña como vigente.
        console.log('Usuario actual:', username);
        console.log('La contraseña fue personalizada desde el panel y no se puede consultar. Usa la que guardaste al cambiarla.');
        return;
    }

    console.log('Usuario:', credentials.username);
    console.log('Contraseña:', credentials.password);
}

// Importar localAccess desde el servidor no debe ejecutar el comando de consola.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await main();
}
