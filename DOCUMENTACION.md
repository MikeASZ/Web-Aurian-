# Documentación del código

El código contiene **31,98 % de líneas de comentario** sobre las líneas no vacías del conjunto del código fuente: **1 362 de 4 259**.

La medida incluye JavaScript, HTML, CSS, SQL y pruebas. Cuenta líneas completas de comentarios y sus delimitadores; excluye líneas vacías, Markdown, JSON, archivos generados y datos privados. El objetivo del 30 % se aplica al conjunto del proyecto, no a cada archivo individual.

Se priorizaron las reglas de precios y horarios, el acceso administrativo, los conflictos de edición, las migraciones, los respaldos y la sincronización del carrito. Los comentarios explican el papel de cada transformación y distinguen las funciones puras de los efectos sobre el navegador o la base de datos.

## Repetir la medición

En VS Code: **Terminal → Ejecutar tarea → Aurian: medir comentarios**.

Desde la carpeta del proyecto:

```powershell
node scripts/comment-coverage.mjs --check
```

## Desglose por archivo

| Archivo | Comentarios | Líneas no vacías | Proporción |
| --- | ---: | ---: | ---: |
| src/auth.js | 76 | 114 | 66.7% |
| src/domain.js | 135 | 286 | 47.2% |
| src/worker.js | 199 | 478 | 41.6% |
| public/admin.html | 63 | 342 | 18.4% |
| public/admin.js | 154 | 453 | 34.0% |
| public/common.js | 66 | 136 | 48.5% |
| public/index.html | 66 | 244 | 27.0% |
| public/menu.js | 109 | 355 | 30.7% |
| public/styles.css | 133 | 632 | 21.0% |
| scripts/admin-key.mjs | 41 | 105 | 39.0% |
| scripts/comment-coverage.mjs | 28 | 89 | 31.5% |
| scripts/dev.mjs | 54 | 147 | 36.7% |
| scripts/sqlite-adapter.mjs | 70 | 163 | 42.9% |
| test/api.test.mjs | 38 | 171 | 22.2% |
| test/cart-reset.test.mjs | 13 | 136 | 9.6% |
| test/credentials.test.mjs | 17 | 109 | 15.6% |
| test/domain.test.mjs | 29 | 103 | 28.2% |
| test/migration.test.mjs | 9 | 57 | 15.8% |
| test/persistence.test.mjs | 8 | 38 | 21.1% |
| migrations/0001_initial.sql | 38 | 77 | 49.4% |
| migrations/0002_admin_credentials.sql | 16 | 24 | 66.7% |

## Dónde estudiar la programación funcional

- `src/domain.js`: `map` valida días y transforma líneas de pedido; los comentarios señalan cuándo un callback usa estado local. La fecha explícita permite probar el horario de forma determinista.
- `public/menu.js`: `filter` depura el carrito, `find` busca productos vigentes y `reduce` obtiene el subtotal. Se explica que las copias de arreglos no son copias profundas de sus objetos.
- `public/admin.js`: `action` es una función de orden superior que recibe una operación asíncrona y centraliza bloqueo y errores. Los listeners registran callbacks que se ejecutan al ocurrir un evento.
- `public/common.js`: se documenta la diferencia entre transformar datos y producir efectos, como llamar a `fetch`, modificar el DOM o comprimir una imagen.
- `scripts/sqlite-adapter.mjs`: `map`, `filter` y `every` ayudan a identificar migraciones pendientes; las transacciones y escrituras son operaciones con efectos.

## Validación

Las pruebas de `test/` cubren precios, horarios, acceso administrativo, imágenes, persistencia y migraciones. Se ejecutan con `node --test test/*.test.mjs`. La proporción de comentarios se comprueba por separado con `node scripts/comment-coverage.mjs --check`.
