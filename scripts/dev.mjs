/** Servidor de desarrollo local. Ejecuta el mismo Worker usando SQLite como adaptador de D1. */
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/worker.js';
import { createDatabase, backupBeforeMigrations } from './sqlite-adapter.mjs';
import { localAccess } from './admin-key.mjs';
/**
 * Calcula rutas desde la ubicación del propio módulo y no desde la carpeta de
 * la terminal.
 * Así ejecutar F5 o iniciar por consola accede a la misma carpeta public y a
 * la misma base local.
 * fileURLToPath convierte la URL del módulo a una ruta válida de Windows.
 * El directorio público contiene recursos estáticos; la base y los secretos
 * se guardan en .local y no se sirven por esta ruta.
 */
const root = fileURLToPath(new URL('../', import.meta.url)), publicDir = path.join(root, 'public');
await mkdir(path.join(root, '.local'), { recursive: true });
/**
 * La base de desarrollo vive en .local y conserva los cambios entre reinicios.
 * El respaldo se realiza antes de aplicar migraciones que cambien el esquema.
 * createDatabase aplica solamente migraciones pendientes y no vuelve a sembrar
 * productos eliminados.
 * Este archivo no se sincroniza automáticamente con la base remota de
 * Cloudflare.
 */
const databasePath = path.join(root, '.local', 'aurian.db');
if (await backupBeforeMigrations(databasePath)) {
    console.log('Respaldo de la base creado en .local/backups antes de actualizar.');
}
const DB = createDatabase(databasePath);
/**
 * Implementa las dependencias que el Worker recibiría en Cloudflare.
 * DB es el adaptador de SQLite y ASSETS.fetch sirve archivos estáticos de
 * public.
 * La comprobación de la ruta resuelta evita salir de esa carpeta al solicitar
 * un archivo.
 * El Worker y las reglas de negocio no necesitan saber si se ejecutan aquí o
 * en la nube.
 */
const env = {
    DB, ...localAccess().env, ASSETS: { async fetch(request) {
            const url = new URL(request.url);
            let name;
            try {
                name = decodeURIComponent(url.pathname);
            }
            catch {
                return new Response('Ruta no válida', { status: 400 });
            }
            if (name === '/') {
                name = '/index.html';
            }
            const target = path.resolve(publicDir, '.' + name);
            if (!target.startsWith(publicDir + path.sep)) {
                return new Response('No encontrado', { status: 404 });
            }
            try {
                const bytes = await readFile(target), types = {
                    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8'
                };
                return new Response(request.method === 'HEAD' ? null : bytes, { headers: {
                        'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache'
                    } });
            }
            catch {
                return new Response('No encontrado', { status: 404 });
            }
        } }
};
const port = Number(process.env.PORT || 8787), hostname = '127.0.0.1';
/**
 * Callback asíncrono que Node ejecuta una vez por cada petición HTTP local.
 * Comprueba el host y limita el cuerpo antes de convertirlo a la API estándar
 * Request.
 * Delega el procesamiento al mismo Worker de producción y adapta la Response
 * de vuelta a Node.
 * El límite exterior también protege al servidor antes de llegar a la lectura
 * limitada de la API.
 * No registra cuerpos de formularios ni valores de contraseñas.
 */
const server = http.createServer(async (incoming, outgoing) => {
    try {
        const host = incoming.headers.host;
        if (![`${hostname}:${port}`, `localhost:${port}`].includes(host)) {
            outgoing.writeHead(403);
            outgoing.end();
            return;
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of incoming) {
            size += chunk.length;
            if (size > 200 * 1024) {
                outgoing.writeHead(413);
                outgoing.end();
                return;
            }
            chunks.push(chunk);
        }
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
            if (value) {
                headers.set(key, Array.isArray(value) ? value.join(',') : value);
            }
        }
        const request = new Request(`http://${host}${incoming.url}`, {
            method: incoming.method, headers, ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Buffer.concat(chunks) } : {})
        });
        const response = await worker.fetch(request, env);
        outgoing.writeHead(response.status, Object.fromEntries(response.headers));
        outgoing.end(Buffer.from(await response.arrayBuffer()));
    }
    catch {
        outgoing.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        outgoing.end('No se pudo procesar la solicitud.');
    }
});
/**
 * Inicia la escucha solo en loopback: la dirección local pertenece a esta
 * computadora.
 * El callback se ejecuta cuando el servidor ya puede aceptar conexiones.
 * La línea Aurian: permite que la configuración de depuración abra el
 * navegador al detectar la dirección.
 * Este inicio no publica la página en Internet ni configura Cloudflare.
 */
server.listen(port, hostname, () => {
    console.log(`Aurian: http://${hostname}:${port}`);
    console.log(`Administración: http://${hostname}:${port}/admin`);
    console.log('Ejecuta npm run access para consultar tu acceso local.');
});
/**
 * Registra callbacks para detener el servidor cuando la terminal o el
 * depurador lo soliciten.
 * Primero deja de aceptar conexiones y después cierra la base de datos.
 * La secuencia evita abandonar una conexión SQLite al terminar normalmente el
 * proceso.
 * Registrar estos callbacks no los ejecuta de inmediato: se invocan al recibir
 * la señal.
 */
for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => {
        DB.close();
        process.exit(0);
    }));
}
