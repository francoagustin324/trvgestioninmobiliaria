declare module '/dist/store.js' {
  export const state: {
    activeMemberId: number;
    activeModule: import('../models.js').ModuleId;
  };

  export function setActiveMemberId(memberId: number): void;
  export function restoreLatestLocalBackup(): boolean;
}
