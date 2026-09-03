import type { Client } from './models.js';
import type { QualificationProgress } from './lead-pipeline-essential.js';

export type PipelineStage = 'contacted' | 'in_visit' | 'reserved' | 'on_hold' | 'lost' | 'won';

export interface PipelineStatus {
  stage: PipelineStage;
  label: string;
  className: string;
}

export function getPipelineStatus(client: Client, qualification: QualificationProgress): PipelineStatus {
  if (client.pipelineStage) {
    return mapStage(client.pipelineStage);
  }

  if (!qualification.hasPhone) return mapStage('contacted');

  if (!qualification.isComplete) return mapStage('contacted');

  return mapStage('contacted');
}

function mapStage(stage: PipelineStage): PipelineStatus {
  switch (stage) {
    case 'in_visit':
      return { stage, label: 'En visita', className: 'lead-pipeline-status--visit' };
    case 'reserved':
      return { stage, label: 'Reservó', className: 'lead-pipeline-status--reserved' };
    case 'on_hold':
      return { stage, label: 'En pausa', className: 'lead-pipeline-status--paused' };
    case 'lost':
      return { stage, label: 'Perdido', className: 'lead-pipeline-status--lost' };
    case 'won':
      return { stage, label: 'Ganado', className: 'lead-pipeline-status--won' };
    default:
      return { stage: 'contacted', label: 'Contactado', className: 'lead-pipeline-status--contacted' };
  }
}
