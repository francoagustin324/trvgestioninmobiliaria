import { state } from './store.js';
import { activeMember, canAccessModule, visibleConversations } from './team-access.js';
import { renderTeam, renderTeamAccount } from './team-ui.js';

let initialized = false;

function ensureTeamDom(): void {
  const nav = document.querySelector<HTMLElement>('.premium-sidebar nav');
  if (nav && !nav.querySelector('[data-module="equipo"]')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nav-button';
    button.dataset.module = 'equipo';
    button.textContent = 'Equipo';
    const agenda = nav.querySelector('[data-module="agenda"]');
    agenda?.insertAdjacentElement('afterend', button);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      state.activeModule = 'equipo';
      syncTeamUi();
      document.body.classList.remove('mobile-nav-open');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  const content = document.querySelector<HTMLElement>('.premium-content');
  if (content && !content.querySelector('#equipo')) {
    const section = document.createElement('section');
    section.id = 'equipo';
    section.className = 'module-panel';
    const agenda = content.querySelector('#agenda');
    agenda?.insertAdjacentElement('afterend', section);
  }

  const topbar = document.querySelector<HTMLElement>('.topbar');
  if (topbar && !topbar.querySelector('#team-account')) {
    const account = document.createElement('div');
    account.id = 'team-account';
    topbar.querySelector('#cloud-account')?.insertAdjacentElement('beforebegin', account);
  }
}

function applyRoleNavigation(): void {
  const member = activeMember();
  document.querySelectorAll<HTMLButtonElement>('[data-module]').forEach((button) => {
    const module = button.dataset.module;
    const allowed = module ? canAccessModule(module as typeof state.activeModule, member) : true;
    button.hidden = !allowed;
  });
  if (!canAccessModule(state.activeModule, member)) state.activeModule = 'inicio';
}

function applyConversationPrivacyPreview(): void {
  const member = activeMember();
  if (member.role !== 'Corredor') return;
  const visibleIds = new Set(visibleConversations().map((conversation) => conversation.id));
  document.querySelectorAll<HTMLElement>('[data-wa-select]').forEach((thread) => {
    thread.hidden = !visibleIds.has(Number(thread.dataset.waSelect));
  });
  document.querySelector<HTMLElement>('.audit-overview')?.setAttribute('hidden', 'true');
}

function syncTeamUi(): void {
  ensureTeamDom();
  applyRoleNavigation();
  renderTeamAccount();
  const teamContainer = document.querySelector<HTMLElement>('#equipo');
  if (teamContainer) renderTeam(teamContainer);

  document.querySelectorAll<HTMLElement>('.module-panel').forEach((panel) => {
    if (state.activeModule === 'equipo') panel.classList.toggle('active', panel.id === 'equipo');
    else if (panel.id === 'equipo') panel.classList.remove('active');
  });
  document.querySelectorAll<HTMLButtonElement>('[data-module]').forEach((button) => {
    if (button.dataset.module === 'equipo') button.classList.toggle('active', state.activeModule === 'equipo');
    else if (state.activeModule === 'equipo') button.classList.remove('active');
  });
  if (state.activeModule === 'equipo') {
    const title = document.querySelector<HTMLElement>('#module-title');
    if (title) title.textContent = 'Equipo';
  }
  applyConversationPrivacyPreview();
}

function initializeTeamModule(): void {
  if (initialized) return;
  initialized = true;
  ensureTeamDom();
  syncTeamUi();
  document.addEventListener('trv-render', () => window.requestAnimationFrame(syncTeamUi));
  document.addEventListener('click', (event) => {
    const module = (event.target as HTMLElement).closest<HTMLElement>('[data-module]')?.dataset.module;
    if (module && module !== 'equipo') window.requestAnimationFrame(syncTeamUi);
  });
}

window.addEventListener('DOMContentLoaded', initializeTeamModule);
window.setTimeout(initializeTeamModule, 0);
