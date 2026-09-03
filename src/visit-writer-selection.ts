export type VisitWriterMode = 'local' | 'legacy-cloud' | 'transactional-cloud';

export interface VisitWriterSelection<T> {
  hasCloudSession: boolean;
  readAuthority: () => Promise<boolean>;
  runLocal: () => Promise<T> | T;
  runLegacyCloud: () => Promise<T> | T;
  runTransactionalCloud: () => Promise<T> | T;
}

export function selectVisitWriterMode(hasCloudSession: boolean, authorityActive?: boolean): VisitWriterMode {
  if (!hasCloudSession) return 'local';
  if (authorityActive === false) return 'legacy-cloud';
  if (authorityActive === true) return 'transactional-cloud';
  throw new Error('La capability de Visit debe resolverse antes de seleccionar el writer cloud.');
}

/**
 * Selección inicial de writer. Deliberadamente no captura errores del writer elegido:
 * una vez seleccionado transactional-cloud, cualquier error se propaga fail-closed.
 */
export async function executeVisitWriterSelection<T>(selection: VisitWriterSelection<T>): Promise<T> {
  if (!selection.hasCloudSession) return selection.runLocal();
  const authorityActive = await selection.readAuthority();
  const mode = selectVisitWriterMode(true, authorityActive);
  if (mode === 'legacy-cloud') return selection.runLegacyCloud();
  return selection.runTransactionalCloud();
}
