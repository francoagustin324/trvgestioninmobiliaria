/* Íconos de línea de la app (una sola fuente para reutilizarlos donde haga falta:
   menú lateral, estados vacíos, etc.). Estilo consistente: trazo, sin relleno,
   viewBox 24×24. El color y el grosor los define el CSS (stroke: currentColor). */

export const appIcons = {
  // Leads: una persona + signo "+" (captar contacto). Distinto del ícono de Equipo.
  leads: '<svg viewBox="0 0 24 24" role="img"><circle cx="9" cy="7" r="4"/><path d="M2.5 20v-1a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1"/><path d="M19 7v6M22 10h-6"/></svg>',
  // Conversaciones: burbuja de chat con cola y dos líneas.
  conversaciones: '<svg viewBox="0 0 24 24" role="img"><path d="M20 12.5a2.5 2.5 0 0 1-2.5 2.5H9l-4 4V6.5A2.5 2.5 0 0 1 7.5 4h10A2.5 2.5 0 0 1 20 6.5Z"/><path d="M8 8.5h8M8 11.5h5"/></svg>',
  // Seguimientos: calendario con tilde.
  seguimientos: '<svg viewBox="0 0 24 24" role="img"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M16 3v4M8 3v4M3.5 9.5h17"/><path d="M9 14.8l2.1 2.1 4.3-4.3"/></svg>',
  // Propiedades: casa con puerta.
  propiedades: '<svg viewBox="0 0 24 24" role="img"><path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9.3V20.3h13V9.3"/><path d="M9.7 20.3v-5.8h4.6v5.8"/></svg>',
  // Equipo/Usuarios: grupo de personas (dos figuras).
  usuarios: '<svg viewBox="0 0 24 24" role="img"><circle cx="8.5" cy="7.5" r="3.7"/><path d="M2 20v-1a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v1"/><path d="M16.3 4a3.7 3.7 0 0 1 0 7"/><path d="M22 20v-1a5 5 0 0 0-3.7-4.83"/></svg>',
} as const;
