import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDatabase } from '../scripts/sqlite-adapter.mjs';
/**
 * Simula cerrar y volver a abrir la conexión SQLite después de editar el
 * catálogo.
 * La eliminación y el precio modificado deben seguir presentes tras la
 * reapertura.
 * Esta prueba detecta el error de volver a sembrar datos iniciales en cada
 * inicio del servidor.
 */
test('reiniciar conserva los cambios y no restaura productos eliminados', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aurian-test-')), file = join(dir, 'test.db');
    let db;
    try {
        db = createDatabase(file);
        await db.prepare('DELETE FROM products WHERE id=?').bind('ceviche').run();
        await db.prepare('UPDATE products SET price_cents=12345 WHERE id=?').bind('aguachile').run();
        db.close();
        db = createDatabase(file);
        assert.equal(await db.prepare('SELECT id FROM products WHERE id=?').bind('ceviche').first(), null);
        assert.equal((await db.prepare('SELECT price_cents FROM products WHERE id=?').bind('aguachile').first()).price_cents, 12345);
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
        rmdirSync(dir);
    }
});
