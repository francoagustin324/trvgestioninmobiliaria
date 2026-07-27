# B0.3 — Diagnóstico del alta e invitación de usuarios

## Estado

Este documento describe una corrección preparada en GitHub. La migración **no fue ejecutada en Supabase** y producción no fue modificada.

## Causa raíz

El flujo actual crea un usuario invitado mediante `POST /auth/v1/admin/generate_link` con tipo `invite`. Supabase Auth inserta primero la fila en `auth.users`; esa inserción dispara `auth.users.on_propcontrol_user_created`. La ruta de Equipo recién después recibe el identificador generado y hace el `upsert` de `public.organization_members` con estado `invited`.

Por lo tanto, durante la ejecución del trigger todavía no existe la membresía invitada que permitiría distinguir el caso. Si el trigger invoca incondicionalmente `public.handle_new_propcontrol_user()`, el usuario invitado puede recibir una organización propia antes de ser asociado a la inmobiliaria invitante.

## Flujo actual inspeccionado

### Registro autónomo

1. `/registro` solicita correo, contraseña y nombre de la inmobiliaria.
2. El navegador llama directamente a `/auth/v1/signup` usando únicamente la clave pública.
3. Envía `company_name` como `user_metadata` no autoritativa.
4. La inserción de `auth.users` dispara `on_propcontrol_user_created`.
5. El handler existente crea la organización y la membresía owner.

El valor `company_name` puede utilizarse como dato de presentación de la organización propia. No debe utilizarse para seleccionar una organización existente, un rol privilegiado ni un estado de membresía.

### Invitación

1. `POST /api/team/invitations` valida la sesión contra `/auth/v1/user`.
2. El servidor obtiene la organización del solicitante mediante `organization_members`; el navegador no elige `organization_id`.
3. El rol solicitado se normaliza a `admin` o `agent`; no se permite invitar otro owner.
4. El servidor usa la clave secreta exclusivamente en Railway para generar el enlace de Auth.
5. Supabase crea el usuario invitado y devuelve su UUID.
6. El servidor hace `upsert` de `(organization_id, user_id)` con el rol validado y estado `invited`.
7. Al definir la contraseña, el cliente autenticado ejecuta `activate_my_organization_memberships()`.
8. B0.1 activa exactamente una membresía `invited`; antes de esa activación, los helpers de acceso solo reconocen `active`.

### Reintentos

- La membresía tiene índice único `(organization_id, user_id)`.
- La creación inicial usa `on_conflict=organization_id,user_id` con resolución de duplicados.
- Si la membresía ya existe, la ruta genera un enlace de recuperación y no consume otro cupo ni crea otra membresía.
- Un segundo registro del mismo usuario no vuelve a insertar la misma fila de `auth.users`, por lo que el trigger no se ejecuta otra vez.

## Ambigüedad observada

La definición exacta de producción de `public.handle_new_propcontrol_user()` no está versionada en las migraciones históricas disponibles. Reescribirla sin el inventario real podría romper columnas, defaults o reglas existentes.

La corrección evita esa suposición: conserva el cuerpo actual del handler y modifica únicamente cuándo puede ejecutarse. Antes de cambiar el trigger, la migración comprueba que el handler existe, devuelve `trigger` y referencia de forma completamente calificada `public.organizations` y `public.organization_members`.

## Solución mínima

La migración `20260727030000_guard_invited_user_onboarding.sql`:

1. verifica la existencia de `auth.users.invited_at`;
2. verifica el handler existente y sus referencias calificadas;
3. fija `SECURITY DEFINER` y `search_path = ''` sin reemplazar su cuerpo;
4. recrea `auth.users.on_propcontrol_user_created` con:

```sql
when (new.invited_at is null)
```

`invited_at` pertenece a `auth.users` y lo controla Supabase Auth. La decisión no depende de `raw_user_meta_data`, `organization_id`, `organization_role`, `company_name` ni otros campos editables por el usuario.

## Comportamiento esperado

### Registro autónomo

- `invited_at` es nulo;
- se ejecuta el handler existente;
- se crea una organización;
- se crea una membresía owner active;
- un reintento que no inserta otra fila de Auth no crea duplicados.

### Usuario invitado

- `invited_at` no es nulo;
- el handler de alta autónoma no se ejecuta;
- el servidor crea únicamente la membresía de la organización invitante;
- se conserva el rol validado por la ruta de Equipo;
- el estado permanece `invited` hasta que el usuario establece la contraseña;
- B0.1 realiza `invited → active`;
- no existe acceso organizacional antes de `active`.

## Seguridad

- El handler queda como `SECURITY DEFINER` con `search_path` vacío.
- La migración utiliza objetos completamente calificados.
- La bifurcación autónomo/invitado usa `auth.users.invited_at`, no metadata editable.
- `organization_id` proviene de la membresía autenticada del solicitante en el servidor.
- El rol se valida en el servidor y nunca puede convertirse en owner desde Equipo.
- La clave secreta permanece en el servidor; el navegador recibe solo la publishable key.
- No se modifica ni deshabilita RLS.
- No se modifica Storage.

## Pruebas

La suite B0.3 incluye controles estáticos y una prueba real en PostgreSQL 17 efímero que reproduce:

- registro autónomo;
- invitación con metadata maliciosa simulada;
- creación de la membresía `invited` en la organización invitante;
- ausencia de acceso antes de la activación;
- conservación del rol después de activar;
- reintentos de registro, invitación y activación;
- ausencia de organizaciones y membresías duplicadas;
- aplicación repetida de la migración.

La prueba aislada no utiliza Supabase de producción.

## Riesgos

1. La migración aborta de forma transaccional si el handler no existe, no devuelve `trigger`, `auth.users.invited_at` no existe o el cuerpo actual no califica las dos tablas principales.
2. La semántica interna del alta autónoma sigue perteneciendo al handler existente; esta etapa no la rediseña.
3. Si en el futuro se agrega otro método de alta administrada que no complete `invited_at`, deberá definirse explícitamente si crea o no una organización.
4. La ruta actual usa `limit=1` para resolver la organización del administrador; B0.3 no implementa organización activa ni modifica esa decisión.

## Rollback funcional

El rollback restaura el trigger anterior sin condición. Debe usarse únicamente para revertir la bifurcación y **reintroduce el riesgo corregido para invitados**:

```sql
begin;

drop trigger if exists on_propcontrol_user_created on auth.users;
create trigger on_propcontrol_user_created
after insert on auth.users
for each row
execute function public.handle_new_propcontrol_user();

commit;
```

Las propiedades `SECURITY DEFINER` y `search_path = ''` se conservan deliberadamente porque son endurecimientos de seguridad y no cambian la lógica funcional del handler.

## Exclusiones

B0.3 no:

- ejecuta SQL;
- modifica Supabase ni producción;
- crea `user_profiles` ni `organization_settings`;
- modifica Storage;
- cambia RLS;
- implementa organización activa;
- modifica `LIMIT 1`;
- agrega funciones del MVP;
- avanza a B1.
