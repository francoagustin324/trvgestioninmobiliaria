# Activación segura del multiusuario de PropControl

Esta guía se ejecuta después de aprobar el PR de autenticación multiusuario. No pegues claves secretas en GitHub, chats, capturas ni archivos del repositorio.

## 1. Respaldo previo

1. Exportar el snapshot actual desde PropControl.
2. Confirmar que el respaldo puede volver a importarse.
3. Conservar el snapshot de Supabase; la migración no lo elimina.

## 2. Aplicar la migración en Supabase

Ejecutar, como una única transacción, el archivo:

`supabase/migrations/20260713_auth_multiusuario_rls.sql`

La migración:

- agrega identificadores estables a los integrantes;
- crea `propcontrol_records`;
- habilita Row Level Security;
- limita al corredor a las filas asignadas;
- permite visión global al dueño y a administradores;
- protege el snapshot histórico para que solo lo lean dueño y administradores;
- conserva los datos anteriores como puente de migración.

Después de ejecutarla, revisar el Security Advisor de Supabase y confirmar que `propcontrol_records` y `organization_members` tengan RLS habilitado.

## 3. Variables privadas en Railway

Configurar exclusivamente en Railway:

- `SUPABASE_URL`: URL del proyecto.
- `SUPABASE_PUBLISHABLE_KEY`: clave pública para el navegador.
- `SUPABASE_SECRET_KEY`: clave `sb_secret_...` para el servidor. Como alternativa temporal se admite `SUPABASE_SERVICE_ROLE_KEY` heredada.
- `APP_PUBLIC_URL`: URL pública exacta de PropControl, sin barra final.

La clave secreta nunca debe aparecer en `/api/cloud-config`, HTML, JavaScript compilado ni registros.

## 4. Configuración de Auth

En Supabase Auth:

1. Establecer la URL pública de PropControl como Site URL.
2. Agregar la misma URL a Redirect URLs.
3. Verificar la plantilla de correo de invitación.
4. Confirmar que el proveedor Email esté habilitado.

## 5. Prueba piloto obligatoria

Usar tres correos de prueba diferentes:

1. **Dueño**
   - ingresa con su cuenta;
   - ve toda la operación;
   - invita un administrador y un corredor;
   - asigna un solo cliente al corredor.

2. **Administrador**
   - ve la operación completa;
   - puede invitar corredores;
   - no puede modificar al dueño ni ascenderse a dueño.

3. **Corredor**
   - recibe el correo y establece su contraseña;
   - solo ve el cliente, conversación, propiedad y tarea asignados;
   - no recibe reportes globales ni configuración;
   - no puede consultar filas ajenas modificando solicitudes del navegador.

4. **Suspensión**
   - el dueño suspende al corredor;
   - la siguiente solicitud del corredor debe ser rechazada;
   - el historial y las asignaciones no deben eliminarse.

## 6. Criterio de publicación

No considerar el multiusuario listo para comercializar hasta completar simultáneamente:

- migración aplicada;
- variables privadas configuradas;
- correo de invitación recibido;
- prueba con tres cuentas;
- prueba negativa de acceso a datos ajenos;
- respaldo verificado;
- GitHub Actions y Railway en estado `success`.
