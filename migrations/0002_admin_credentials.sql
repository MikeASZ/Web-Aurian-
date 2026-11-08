-- Añade el acceso personalizado y la revisión de sesiones sin reemplazar datos existentes.
--
-- Registro único del acceso personalizado por el administrador.
-- password_hash no permite consultar la contraseña; salt cambia cada vez que
-- se guarda un acceso.
-- revision vincula las sesiones con la versión de credenciales que las
-- autorizó.
--
CREATE TABLE IF NOT EXISTS admin_credentials (
    id INTEGER PRIMARY KEY CHECK(id=1),
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    revision INTEGER NOT NULL
);
--
-- Las sesiones anteriores reciben revisión cero y conservan compatibilidad con
-- el acceso inicial.
-- Una modificación del acceso incrementa la revisión y vuelve inválidas las
-- sesiones antiguas.
-- Esta migración agrega información sin reemplazar productos, configuración o
-- fotografías.
--
ALTER TABLE sessions ADD COLUMN credential_revision INTEGER NOT NULL DEFAULT 0;
