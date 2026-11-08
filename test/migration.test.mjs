import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, unlinkSync, rmdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabase, backupBeforeMigrations } from '../scripts/sqlite-adapter.mjs';
/**
 * Construye una base del esquema anterior con cambios que no deben perderse.
 * Elimina un producto de muestra, modifica un precio y añade una configuración
 * e imagen ficticias.
 * Después comprueba el respaldo y la migración, incluyendo que el producto
 * eliminado no reaparezca.
 * Todo ocurre en una carpeta temporal de prueba; no se toca la instalación que
 * utiliza el usuario.
 */
test('actualiza una base anterior sin perder configuración, productos ni imágenes, con respaldo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aurian-migration-')), file = join(dir, 'test.db');
    let db;
    try {
        const old = new DatabaseSync(file);
        old.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
        old.exec("CREATE TABLE _local_migrations(name TEXT PRIMARY KEY); INSERT INTO _local_migrations(name) VALUES('0001_initial'); DELETE FROM products WHERE id='ceviche'; UPDATE products SET price_cents=23456 WHERE id='aguachile';");
        old.prepare('INSERT INTO media(id,mime,bytes,created_at) VALUES(?,?,?,?)').run('test-photo', 'image/png', new Uint8Array([1, 2, 3]), 1);
        old.prepare('UPDATE settings SET data=? WHERE id=1').run('{"name":"Configuración existente"}');
        old.close();
        const saved = await backupBeforeMigrations(file);
        assert.ok(saved && existsSync(saved));
        db = createDatabase(file);
        assert.equal((await db.prepare('SELECT price_cents FROM products WHERE id=?').bind('aguachile').first()).price_cents, 23456);
        assert.equal(await db.prepare('SELECT id FROM products WHERE id=?').bind('ceviche').first(), null);
        assert.equal((await db.prepare('SELECT data FROM settings WHERE id=1').first()).data, '{"name":"Configuración existente"}');
        assert.deepEqual(Array.from((await db.prepare('SELECT bytes FROM media WHERE id=?').bind('test-photo').first()).bytes), [1, 2, 3]);
        assert.equal(await backupBeforeMigrations(file), null);
        const restored = new DatabaseSync(saved, { readOnly: true });
        assert.equal(restored.prepare('SELECT price_cents FROM products WHERE id=?').get('aguachile').price_cents, 23456);
        restored.close();
    }
    finally {
        db?.close();
        for (const suffix of ['', '-wal', '-shm']) {
            try {
                unlinkSync(file + suffix);
            }
            catch {
            }
        }
        const backups = join(dir, 'backups');
        if (existsSync(backups)) {
            for (const name of readdirSync(backups)) {
                unlinkSync(join(backups, name));
            }
            rmdirSync(backups);
        }
        rmdirSync(dir);
    }
});
