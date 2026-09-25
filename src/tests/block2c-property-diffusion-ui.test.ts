import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const opportunities = readFileSync('src/property-opportunities-ui.ts', 'utf8');
const diffusionUi = readFileSync('src/property-diffusion-ui.ts', 'utf8');
const diffusion = readFileSync('src/property-diffusion.ts', 'utf8');
const css = readFileSync('src/property-opportunities.css', 'utf8');
const matching = readFileSync('src/property-opportunities.ts', 'utf8');

test('2C UI: selección masiva prepara revisión pero no envía automáticamente', () => {
  assert.ok(opportunities.includes('data-prepare-diffusion'));
  assert.ok(opportunities.includes('selectedClientIds'));
  assert.ok(diffusionUi.includes('Preparando difusión'));
  assert.ok(diffusionUi.includes('Abrir WhatsApp'));
  assert.ok(diffusionUi.includes('Marcar como enviado'));
  assert.ok(diffusionUi.includes('Abrir un canal no registra un envío'));
  assert.ok(diffusionUi.includes('recordPropertyDiffusionSent'));
  assert.equal(diffusionUi.includes('recordPropertyDiffusionSent({\n          scope: review.scope') && diffusionUi.includes("data-diffusion-open-whatsapp href"), true);
});

test('2C UI: ficha pública y matching reutilizan los contratos canónicos', () => {
  assert.ok(diffusionUi.includes('publishAndRememberPropertyFicha'));
  assert.ok(diffusion.includes('propertyShareText'));
  assert.ok(matching.includes('return matchClientsForProperty(property, clients).map'));
  assert.ok(opportunities.includes('buildPropertyOpportunities(property, clients)'));
});

test('2C UI: email-only, reenvío, respuesta y seguimiento opcional están explícitos', () => {
  assert.ok(diffusionUi.includes('Preparar email'));
  assert.ok(diffusionUi.includes('Marcar reenvío como enviado'));
  assert.ok(diffusionUi.includes('Respondió'));
  assert.ok(diffusionUi.includes('Agregar seguimiento'));
  assert.ok(opportunities.includes("state.editingClientId = clientId"));
  assert.ok(opportunities.includes("state.openForms.client = true"));
  assert.equal(diffusionUi.includes('nextAction ='), false);
  assert.equal(diffusionUi.includes('nextFollowUp ='), false);
});

test('2C UI: historial previo se advierte sin bloquear un reenvío', () => {
  assert.ok(opportunities.includes('✓ Ya difundida'));
  assert.ok(opportunities.includes("diffusion.status === 'RESPONDIO'"));
  assert.ok(diffusionUi.includes('latestPropertyDiffusion'));
  assert.ok(diffusionUi.includes('Marcar reenvío como enviado'));
});

test('2C mobile: revisión y acciones evitan overflow y mantienen blancos táctiles', () => {
  assert.ok(css.includes('.property-diffusion-host'));
  assert.ok(css.includes('.diffusion-message textarea'));
  assert.ok(css.includes('max-width:100%'));
  assert.ok(css.includes('@media (max-width:640px)'));
  assert.ok(css.includes('.diffusion-review{padding:14px;overflow-x:hidden}'));
  assert.ok(css.includes('min-height:44px'));
});
