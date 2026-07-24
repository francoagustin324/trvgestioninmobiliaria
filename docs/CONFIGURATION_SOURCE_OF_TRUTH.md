# Fuente de verdad de Configuración

## Estado de este documento

Este documento define contratos de dominio y reglas de precedencia para futuros cambios de PropControl.

No modifica la persistencia actual, no crea tablas, no conecta los contratos a la interfaz y no afirma que la persistencia futura ya exista. Todo lo descrito como **propuesto** requiere implementación posterior.

## 1. Problema actual

El modelo actual conserva un único objeto `CrmData.settings` con campos de distinta propiedad:

- identidad personal;
- datos comerciales de la inmobiliaria;
- preferencias potenciales;
- campos legacy sin efecto funcional confirmado.

La misma estructura no permite distinguir con claridad qué dato pertenece al usuario autenticado, a la relación usuario–inmobiliaria o a la organización. Además, el email oficial de acceso proviene de autenticación y no debe confundirse con `profileEmail`.

Este PR incorpora contratos y funciones puras sin conectarlos a producción. `Settings`, `CrmData`, la serialización y la interfaz continúan sin cambios.

## 2. Fuente oficial de cada dato

### Modelo actual

- `CrmData.organization.name` contiene el nombre organizacional usado por el modelo moderno.
- `CrmData.teamMembers` contiene identidad legacy junto con rol y estado.
- `CrmData.settings` mezcla perfil, inmobiliaria y preferencias.
- El email de la sesión proviene del sistema de autenticación.

### Contrato propuesto

- **Identidad personal:** `UserProfile`, vinculada a `userId`.
- **Email oficial:** `AuthIdentity.email`, proveniente de autenticación.
- **Nombre comercial:** `organization.name`.
- **Configuración comercial:** `OrganizationConfiguration`, vinculada a `organizationId`.
- **Rol y estado:** `OrganizationMembership`, vinculada a `organizationId` + `userId`.
- **Preferencias personales:** `UserPreferences`; permanece vacío hasta que exista una preferencia real.

### Persistencia futura

Este PR no selecciona ni crea tablas, columnas, buckets, endpoints o políticas. La persistencia futura se definirá en PR B después de aprobar estos contratos.

## 3. Matriz campo → propietario

| Campo actual | Propietario futuro | Estado actual | Regla |
|---|---|---|---|
| `profileName` | `user_profile` | Legacy activo | Fallback posterior a `UserProfile` y nombre legacy de membresía. |
| `profileEmail` | `legacy_only` → `auth_identity` | Guardado, no oficial | Nunca desplaza un email válido de autenticación. |
| `profilePhone` | `user_profile` | Guardado, sin consumo confirmado fuera de Configuración | Fallback personal legacy. |
| `avatar` | `user_profile` | Legacy activo | Data URI actual; el contrato futuro usa `avatarPath`. |
| `agencyName` | `organization` | Guardado, sin consumo comercial confirmado | Nunca desplaza un `organization.name` válido. |
| `agencyWhatsapp` | `organization` | Guardado, sin conexión actual a fichas | Fallback de teléfono comercial. |
| `agencyLegal` | `organization` | Guardado, sin conexión actual a fichas | Fallback de texto legal. |
| `currency` | `organization` | Guardado, sin consumo operativo confirmado | Fallback de moneda organizacional. |
| `defaultZone` | `organization` | Guardado, sin consumo operativo confirmado | Fallback de zona comercial. |
| `shareText` | `organization` | Guardado, sin conexión actual al compartir | Fallback de texto sugerido. |
| `overdueDays` | `legacy_only` | Sin efecto actual | Agenda considera vencida toda fecha anterior a hoy. |

## 4. Reglas de precedencia

### Nombre personal

1. `UserProfile.displayName`.
2. Nombre legacy de `OrganizationMembership`.
3. `Settings.profileName` legacy.
4. Parte local de `AuthIdentity.email`.
5. Fallback neutral.

### Email personal

1. `AuthIdentity.email`.
2. Email legacy de membresía, solo como fallback informativo.
3. `Settings.profileEmail`, únicamente como último fallback legacy.

`profileEmail` nunca es fuente oficial ni puede reemplazar un email válido de autenticación.

### Nombre comercial

1. `organization.name`.
2. `Settings.agencyName` legacy.
3. Fallback neutral.

### Configuración organizacional

1. `OrganizationConfiguration` propuesta.
2. Campos equivalentes de `Settings` legacy.
3. Defaults seguros.

Los valores vacíos o compuestos solo por espacios no desplazan una fuente válida de menor prioridad.

## 5. Campos legacy

Los siguientes campos permanecen obligatorios dentro de `Settings` durante la compatibilidad:

- `profileName`;
- `profileEmail`;
- `profilePhone`;
- `avatar`;
- `agencyName`;
- `agencyWhatsapp`;
- `agencyLegal`;
- `currency`;
- `defaultZone`;
- `shareText`;
- `overdueDays`.

Este PR no elimina, renombra, vuelve opcional ni cambia el comportamiento de ninguno.

## 6. Campos actualmente sin efecto o sin consumo confirmado

- `overdueDays`: sin efecto en Agenda.
- `profileEmail`: no modifica el email oficial de autenticación.
- `profilePhone`: sin consumo funcional confirmado fuera de Configuración.
- `agencyName`, `agencyWhatsapp` y `agencyLegal`: no controlan todavía las fichas públicas.
- `currency`, `defaultZone` y `shareText`: sin consumo operativo confirmado en los flujos auditados.

Que un campo esté guardado no significa que produzca un efecto funcional.

## 7. Fuera de alcance de PR A

- interfaz de Configuración;
- menú del avatar;
- Equipo;
- login, registro e invitaciones;
- persistencia local o remota;
- sincronización;
- Supabase, SQL, RLS y Storage;
- datos reales;
- endpoints;
- dual-write;
- migración o backfill;
- fichas públicas;
- Agenda, Leads, Propiedades y Chats;
- eliminación de campos legacy.

Los contratos nuevos no son importados por el código de producción en este PR.

## 8. Plan futuro resumido

### PR B — Migración y compatibilidad

Definir persistencia, backfill, seguridad, compatibilidad temporal y rollback. Requiere diseño y validación explícita antes de crear SQL.

### PR C — Interfaz funcional

Separar “Mi perfil” de “Inmobiliaria”, aplicar permisos reales y mostrar confirmación correcta de guardado.

### PR D — Visual móvil

Mejorar Configuración en 430 px, 720 px y escritorio después de resolver el modelo funcional.

### PR E — Limpieza legacy

Retirar campos antiguos únicamente después de validar migración, compatibilidad y uso real en producción.

## 9. Condición de rollback

PR A es aditivo: crea un módulo de dominio, pruebas y documentación. El rollback consiste en revertir esos archivos. Como ninguna ruta de producción los importa, revertirlos no requiere transformar datos ni restaurar persistencia.

Para PR B, el diseño deberá conservar una ruta de lectura legacy y un respaldo verificable antes de modificar datos.

## 10. Prohibición de eliminación anticipada

No se puede eliminar, renombrar ni dejar de leer ningún campo legacy antes de completar:

1. persistencia futura;
2. backfill verificado;
3. compatibilidad temporal;
4. pruebas con usuarios existentes e invitados;
5. rollback probado;
6. validación manual en producción controlada.

Hasta entonces, el contrato nuevo es una definición de dominio y no una sustitución de datos existentes.
