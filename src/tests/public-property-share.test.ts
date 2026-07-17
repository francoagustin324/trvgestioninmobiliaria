import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPropertyPublicSlug, propertyPublicUrl } from '../public-property-share.js';

const share = readFileSync('src/public-property-share.ts', 'utf8');
const main = readFileSync('src/mvp-main.ts', 'utf8');
const server = readFileSync('src/server.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260717113000_public_property_fichas.sql', 'utf8');

test('genera un slug legible, corto y sin datos sensibles', () => {
  const slug = createPropertyPublicSlug('Casa Duarte Quirós');
  assert.match(slug, /^casa-duarte-quiros-[a-z0-9]{7}$/);
  assert.ok(slug.length < 80);
});

test('arma una ruta pública corta bajo el dominio configurado', () => {
  assert.equal(
    propertyPublicUrl('casa-duarte-quiros-a7k3p9x', 'https://fichas.propcontrol.com/'),
    'https://fichas.propcontrol.com/ficha/casa-duarte-quiros-a7k3p9x',
  );
});

test('publica por propiedad y conserva el mismo registro editable', () => {
  assert.ok(share.includes("on_conflict', 'organization_id,property_key'"));
  assert.ok(share.includes("Prefer: 'resolution=merge-duplicates,return=representation'"));
  assert.ok(share.includes('property.publicSlug'));
  assert.ok(share.includes('payload: propertyToPublicFicha(property)'));
});

test('la ficha corta se puede abrir sin iniciar sesión', () => {
  assert.ok(main.includes("location.pathname.match(/^\\/ficha\\/"));
  assert.ok(main.includes('await loadPublicPropertyFicha'));
  assert.ok(share.includes('/rest/v1/rpc/get_public_property_ficha'));
  assert.ok(migration.includes('grant execute on function public.get_public_property_ficha(text) to anon, authenticated'));
});

test('la tabla pública protege escritura y no expone información interna', () => {
  assert.ok(migration.includes('create table if not exists public.public_property_fichas'));
  assert.ok(migration.includes('payload jsonb not null'));
  assert.ok(migration.includes('alter table public.public_property_fichas enable row level security'));
  assert.ok(migration.includes('member.user_id = auth.uid()'));
  assert.equal(migration.includes('owner'), false);
  assert.equal(migration.includes('notes'), false);
});

test('el servidor admite un dominio exclusivo para fichas PropControl', () => {
  assert.ok(server.includes('PUBLIC_FICHA_URL'));
  assert.ok(server.includes('publicUrl: publicFichaUrl || undefined'));
});
