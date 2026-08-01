import type { ActivityEntry, Client, CrmData, ModuleId } from '../models.js';

export const state: {
  activeMemberId: number;
  activeModule: ModuleId;
  crm: Omit<CrmData, 'clients' | 'activityLog'> & {
    clients: [Client, ...Client[]];
    activityLog: ActivityEntry[];
  };
};

export function setActiveMemberId(memberId: number): void;
export function restoreLatestLocalBackup(): boolean;
