/** Adaptador local de D1: migraciones incrementales, consultas y transacciones sobre SQLite. */
import { DatabaseSync, backup } from 'node:sqlite';
import { readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
/**
 * Crea una copia consistente solo si el esquema tiene migraciones pendientes.
 * El origen se abre en modo de lectura y la API backup incluye datos
 * confirmados del archivo WAL.
 * filter selecciona archivos SQL y map obtiene los nombres que se comparan con
 * el historial local.
 * every devuelve true cuando todas las migraciones ya están aplicadas y
 * permite omitir una copia innecesaria.
 * El nombre del respaldo combina tiempo y un identificador para no
 * sobrescribir copias previas.
 */
export async function backupBeforeMigrations(path) {
    if (!existsSync(path)) {
        return null;
    }
    const source = new DatabaseSync(path, { readOnly: true });
    try {
        const names = readdirSync(new URL('../migrations/', import.meta.url)).filter(name => /^\d+.*\.sql$/.test(name)).map(name => name.slice(0, -4));
        let applied = [];
        try {
            applied = source.prepare('SELECT name FROM _local_migrations').all().map(row => row.name);
        }
        catch {
        }
        if (names.every(name => applied.includes(name))) {
            return null;
        }
        const directory = join(dirname(path), 'backups');
        mkdirSync(directory, { recursive: true });
        const destination = join(directory, `aurian-before-update-${Date.now()}-${crypto.randomUUID()}.db`);
        await backup(source, destination);
        return destination;
    }
    finally {
        source.close();
    }
}
/**
 * Abre SQLite y ofrece los métodos mínimos de D1 usados por la aplicación.
 * Las migraciones se ordenan y se ejecutan una sola vez dentro de una
 * transacción por archivo.
 * El historial local impide restaurar datos de muestra después de que el
 * administrador los haya eliminado.
 * BEGIN, COMMIT y ROLLBACK mantienen esquema e historial coherentes si una
 * migración falla.
 * La base en memoria se utiliza en pruebas para no tocar la instalación real.
 */
export function createDatabase(path = ':memory:') {
    const sqlite = new DatabaseSync(path);
    sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
    sqlite.exec('CREATE TABLE IF NOT EXISTS _local_migrations (name TEXT PRIMARY KEY)');
    const migrations = new URL('../migrations/', import.meta.url);
    for (const filename of readdirSync(migrations).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
        const name = filename.slice(0, -4);
        if (sqlite.prepare('SELECT name FROM _local_migrations WHERE name=?').get(name)) {
            continue;
        }
        sqlite.exec('BEGIN');
        try {
            sqlite.exec(readFileSync(new URL(filename, migrations), 'utf8'));
            sqlite.prepare('INSERT INTO _local_migrations(name) VALUES(?)').run(name);
            sqlite.exec('COMMIT');
        }
        catch (e) {
            sqlite.exec('ROLLBACK');
            throw e;
        }
    }
/**
 * Objeto que conserva una consulta SQL y sus parámetros, separado de la
 * conexión.
 * bind crea otro Statement: no reemplaza los argumentos de una consulta que
 * otra operación pudiera reutilizar.
 * Los métodos devuelven promesas para mantener la misma interfaz que D1,
 * aunque SQLite local sea síncrono.
 * Este adaptador permite probar la API sin conectarse a Cloudflare.
 */
    class Statement {
        constructor(sql, args = []) {
            this.sql = sql;
            this.args = args;
        }
/**
 * map normaliza los parámetros binarios para node:sqlite.
 * Cloudflare admite ArrayBuffer, mientras la conexión local utiliza un arreglo
 * de bytes compatible.
 * Los demás valores se conservan y nunca se concatenan con el SQL.
 * El nuevo Statement permite encadenar bind y first, all o run sin mutar la
 * consulta anterior.
 */
        bind(...args) {
            return new Statement(this.sql, args.map(a => a instanceof ArrayBuffer ? new Uint8Array(a) : a));
        }
/**
 * Ejecuta una consulta y entrega la primera fila o null cuando no hay
 * coincidencias.
 * Se usa para la configuración única, sesiones, credenciales y búsquedas por
 * identificador.
 * La forma del resultado imita a D1 para no añadir condiciones de entorno en
 * los controladores.
 */
        async first() {
            return sqlite.prepare(this.sql).get(...this.args) || null;
        }
/**
 * Entrega todas las filas dentro de results, igual que la respuesta utilizada
 * de D1.
 * La envoltura success permite mantener un contrato reconocible entre
 * adaptadores.
 * La API extrae results mediante el auxiliar all del Worker.
 */
        async all() {
            return {
                results: sqlite.prepare(this.sql).all(...this.args), success: true
            };
        }
/**
 * Ejecuta escrituras y adapta la información de cambios al formato esperado
 * por el Worker.
 * meta.changes permite comprobar si un UPDATE con revisión realmente modificó
 * un registro.
 * Convertir los identificadores a Number evita devolver un BigInt que JSON no
 * serializa directamente.
 */
        async run() {
            const r = sqlite.prepare(this.sql).run(...this.args);
            return {
                success: true, meta: {
                    changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid)
                }
            };
        }
    }
    return {
/**
 * prepare construye consultas; batch ejecuta un grupo como una unidad atómica.
 * El lote usa un bucle con await para conservar el orden de las escrituras.
 * Si una falla, ROLLBACK revierte lo anterior en vez de dejar una operación a
 * medias.
 * close libera la conexión y queda bajo responsabilidad del servidor o de la
 * prueba que la creó.
 */
        prepare: sql => new Statement(sql), async batch(statements) {
            sqlite.exec('BEGIN');
            try {
                const results = [];
                for (const s of statements) {
                    results.push(await s.run());
                }
                sqlite.exec('COMMIT');
                return results;
            }
            catch (e) {
                sqlite.exec('ROLLBACK');
                throw e;
            }
        }, close: () => sqlite.close()
    };
}
