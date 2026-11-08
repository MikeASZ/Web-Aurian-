-- Esquema inicial y datos de muestra; se ejecuta una sola vez.
PRAGMA foreign_keys = ON;
--
-- Tabla independiente para bytes de imágenes y su tipo de contenido.
-- El catálogo guarda una referencia en lugar de incluir el archivo en cada
-- fila consultada.
-- created_at permite retirar imágenes antiguas que quedaron sin referencias.
--
CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    mime TEXT NOT NULL,
    bytes BLOB NOT NULL,
    created_at INTEGER NOT NULL
);
--
-- Cada fila representa un producto con un único precio expresado en centavos.
-- available permite ocultarlo sin perder su descripción o su fotografía.
-- revision detecta modificaciones simultáneas realizadas desde diferentes
-- sesiones administrativas.
--
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price_cents INTEGER NOT NULL CHECK(price_cents > 0),
    image_id TEXT REFERENCES media(id) ON DELETE SET NULL,
    available INTEGER NOT NULL DEFAULT 1 CHECK(available IN (0,1)),
    position INTEGER NOT NULL DEFAULT 1,
    revision INTEGER NOT NULL DEFAULT 1
);
--
-- Existe una sola configuración del negocio, identificada por id=1.
-- El JSON agrupa horario, datos públicos y banderas de operación.
-- La revisión se almacena por separado para condicionar las actualizaciones de
-- forma atómica.
--
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK(id=1),
    data TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1
);
--
-- Las sesiones conservan únicamente el hash del token y su vencimiento.
-- El token original se entrega en una cookie privada del navegador.
-- La migración siguiente añade la revisión del acceso para revocar sesiones
-- después de cambiar credenciales.
--
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
);
--
-- Contadores temporales para limitar intentos de acceso o de cambio de
-- contraseña.
-- La clave es un hash y reset_at define cuándo vence la ventana de intentos.
-- Las rutas de autenticación eliminan las ventanas vencidas al procesar una
-- petición.
--
CREATE TABLE IF NOT EXISTS login_limits (
    ip_hash TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL,
    reset_at INTEGER NOT NULL
);
--
-- Datos iniciales de demostración, no confirmados para recibir pedidos reales.
-- Las migraciones se registran y no se repiten al reiniciar la aplicación.
-- El administrador puede modificar estos datos y eliminar productos sin que
-- reaparezcan en el siguiente inicio.
--
INSERT OR IGNORE INTO settings(id,data) VALUES(1,'{"name":"Aurian","tagline":"Aguachiles & ceviches","whatsapp":"","address":"","mapUrl":"","logoId":null,"timezone":"America/Mexico_City","scheduleReady":false,"temporaryClosed":false,"catalogConfirmed":false,"hours":[null,null,null,null,null,null,null]}');
INSERT OR IGNORE INTO products(id,name,description,price_cents,position) VALUES
('aguachile','Aguachile','Camarón con chile verde, pepino y cebolla morada.',11000,1),
('ceviche','Ceviche','Pescado con jitomate, pepino, cebolla y cilantro.',9000,2),
('tosticeviche','Tosticeviche','Tostitos crujientes con ceviche de pescado.',14000,3),
('tacos-gobernador','Tacos gobernador','Camarón, pimientos y queso fundido. Precio por unidad.',3000,4),
('michelada-clamato','Michelada clamato','Cerveza con clamato, limón, salsas y especias.',9000,5),
('michelada-clasica','Michelada clásica','Cerveza con jugo de limón y salsas.',8000,6);
