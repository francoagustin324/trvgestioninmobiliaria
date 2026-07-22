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
  // Contacto: WhatsApp (glifo relleno), teléfono, mail.
  whatsapp: '<svg viewBox="0 0 24 24" role="img"><path d="M12 2.2A9.8 9.8 0 0 0 3.5 17l-1.3 4.8 4.9-1.3A9.8 9.8 0 1 0 12 2.2Zm0 17.8a8 8 0 0 1-4.1-1.1l-.3-.2-2.9.8.8-2.8-.2-.3A8 8 0 1 1 12 20Zm4.5-6c-.25-.12-1.45-.72-1.67-.8-.22-.08-.38-.12-.55.12-.16.25-.63.8-.77.96-.14.17-.28.19-.53.06-.25-.12-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.14-.25-.02-.38.11-.5.11-.11.25-.28.37-.42.12-.14.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.55-1.33-.76-1.82-.2-.48-.4-.41-.55-.42h-.47c-.16 0-.42.06-.64.31-.22.25-.84.82-.84 2s.86 2.32.98 2.48c.12.17 1.7 2.6 4.13 3.65.58.25 1.03.4 1.38.51.58.18 1.1.16 1.52.1.46-.07 1.45-.59 1.65-1.16.2-.57.2-1.06.14-1.16-.06-.1-.22-.16-.47-.28Z"/></svg>',
  phone: '<svg viewBox="0 0 24 24" role="img"><path d="M22 16.9v2.6a2 2 0 0 1-2.2 2 19.6 19.6 0 0 1-8.5-3 19.3 19.3 0 0 1-6-6 19.6 19.6 0 0 1-3-8.6A2 2 0 0 1 4.3 2h2.6a2 2 0 0 1 2 1.7c.1.9.3 1.7.6 2.5a2 2 0 0 1-.5 2.1L8 9.3a16 16 0 0 0 6 6l1-1a2 2 0 0 1 2.1-.5c.8.3 1.6.5 2.5.6a2 2 0 0 1 1.7 2Z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" role="img"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 6.8 8.5 6 8.5-6"/></svg>',
  // Editar (lápiz).
  edit: '<svg viewBox="0 0 24 24" role="img"><path d="M4 20h4L18.5 9.5a2 2 0 0 0-2.83-2.83L5 17.2Z"/><path d="M13.5 7.5 16.5 10.5"/></svg>',
} as const;
