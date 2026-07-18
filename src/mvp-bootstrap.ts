import { isInvitationPage, renderInvitationAuth } from './mvp-invitation-auth.js';

const root = document.querySelector<HTMLElement>('#root');

if (!root) {
  throw new Error('No se encontró el contenedor principal de PropControl.');
}

if (isInvitationPage()) {
  void renderInvitationAuth(root);
} else {
  void import('./mvp-main.js');
}
