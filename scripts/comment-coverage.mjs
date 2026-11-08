/**
 * Mide comentarios de código fuente sin leer bases, fotografías ni credenciales.
 * La medida es física: líneas de comentario / líneas no vacías del código.
 * Incluye JavaScript, HTML, CSS, SQL y las pruebas, no archivos de documentación.
 * No cuenta comentarios al final de una instrucción como líneas completas.
 * Esta cifra ayuda a mantener la documentación; no mide su calidad por sí sola.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// La raíz se calcula desde el módulo, igual que en el servidor de desarrollo.
// Así funciona desde una tarea de VS Code o desde cualquier carpeta de la terminal.
const root = fileURLToPath(new URL('../', import.meta.url));
const directories = ['src', 'public', 'scripts', 'test', 'migrations'];

/**
 * Cuenta únicamente comentarios que ocupan una línea propia.
 * Los bloques que escribe el proyecto empiezan al inicio de una línea indentada.
 * Las líneas vacías no aumentan ni el numerador ni el denominador.
 * Las marcas de apertura y cierre pertenecen al bloque y también se cuentan.
 * JSON queda fuera porque no admite comentarios; Markdown tampoco es código.
 */
function countLines(source, extension) {
    let total = 0;
    let comments = 0;
    let closing = null;

    for (const line of source.split(/\r?\n/)) {
        const text = line.trim();
        if (!text) {
            continue;
        }
        total++;

        // Mientras un bloque esté abierto, su contenido pertenece al comentario.
        // El proyecto no mezcla instrucciones con el cierre de un bloque.
        if (closing) {
            comments++;
            if (text.includes(closing)) {
                closing = null;
            }
            continue;
        }

        // Cada lenguaje utiliza delimitadores distintos para comentarios completos.
        // El estado solo se conserva para comentarios que abarcan varias líneas.
        if (extension === '.html' && text.startsWith('<!--')) {
            comments++;
            closing = text.includes('-->') ? null : '-->';
        } else if (['.js', '.mjs', '.css'].includes(extension) && text.startsWith('/*')) {
            comments++;
            closing = text.includes('*/') ? null : '*/';
        } else if (['.js', '.mjs'].includes(extension) && text.startsWith('//')) {
            comments++;
        } else if (extension === '.sql' && text.startsWith('--')) {
            comments++;
        }
    }

    return { total, comments, code: total - comments };
}

const rows = [];
for (const directory of directories) {
    // Se recorre una lista explícita de carpetas de código, excluyendo .local.
    // No se necesitan dependencias ni acceso a Internet para obtener el informe.
    for (const file of readdirSync(path.join(root, directory), { withFileTypes: true })) {
        const extension = path.extname(file.name);
        if (!file.isFile() || !['.js', '.mjs', '.css', '.html', '.sql'].includes(extension)) {
            continue;
        }
        const name = directory + '/' + file.name;
        rows.push({ name, ...countLines(readFileSync(path.join(root, name), 'utf8'), extension) });
    }
}

// reduce convierte todas las medidas individuales en una sola medida del proyecto.
// El callback devuelve otro acumulador; no modifica las filas del informe.
const totals = rows.reduce((sum, row) => ({
    total: sum.total + row.total,
    comments: sum.comments + row.comments,
}), { total: 0, comments: 0 });
const percent = totals.total ? totals.comments / totals.total * 100 : 0;

// El desglose permite revisar dónde se concentra la documentación explicativa.
// El objetivo del 30% se aplica al conjunto del código fuente, no a cada archivo.
console.log('Archivo | Comentarios | Líneas no vacías | Proporción');
for (const row of rows) {
    console.log(`${row.name} | ${row.comments} | ${row.total} | ${(row.comments / row.total * 100).toFixed(1)}%`);
}
console.log(`TOTAL: ${totals.comments}/${totals.total} = ${percent.toFixed(2)}%`);

// --check permite usar el mismo cálculo como tarea de verificación repetible.
// El valor sin redondear determina el resultado para no aceptar un 29,999%.
if (process.argv.includes('--check') && percent < 30) {
    console.error('La documentación del código debe alcanzar al menos el 30%.');
    process.exitCode = 1;
}
