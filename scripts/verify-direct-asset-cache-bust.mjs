#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const LOCAL_ORIGIN = 'https://propcontrol.local';

function git(cwd, args, { allowFailure = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trimEnd();
  } catch (error) {
    if (allowFailure) return null;
    const stderr = error?.stderr ? String(error.stderr).trim() : '';
    throw new Error(`git ${args.join(' ')} falló${stderr ? `: ${stderr}` : ''}`);
  }
}

function gitObjectExists(cwd, ref, path) {
  return git(cwd, ['cat-file', '-e', `${ref}:${path}`], { allowFailure: true }) !== null;
}

function gitText(cwd, ref, path) {
  return git(cwd, ['show', `${ref}:${path}`], { allowFailure: true });
}

function gitBlob(cwd, ref, path) {
  return git(cwd, ['rev-parse', `${ref}:${path}`], { allowFailure: true });
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match?.[2] ?? null;
}

function normalizeLocalAsset(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl, `${LOCAL_ORIGIN}/`);
  } catch {
    return null;
  }
  if (url.origin !== LOCAL_ORIGIN) return null;
  const servedPath = url.pathname.startsWith('/') ? url.pathname : `/${url.pathname}`;
  return {
    rawUrl,
    servedPath,
    repositoryPath: decodeURIComponent(servedPath).replace(/^\/+/, ''),
    versioned: url.searchParams.has('v'),
    version: url.searchParams.get('v') ?? '',
  };
}

export function directAssetsFromHtml(html) {
  const assets = [];
  for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
    const src = attribute(match[0], 'src');
    if (!src) continue;
    const asset = normalizeLocalAsset(src);
    if (asset) assets.push({ ...asset, kind: 'script' });
  }
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = attribute(match[0], 'rel');
    const href = attribute(match[0], 'href');
    if (!href || !rel?.split(/\s+/).some((token) => token.toLowerCase() === 'stylesheet')) continue;
    const asset = normalizeLocalAsset(href);
    if (asset) assets.push({ ...asset, kind: 'stylesheet' });
  }
  return assets;
}

function sourceCandidates(asset) {
  const candidates = [];
  if (asset.servedPath.startsWith('/dist/') && asset.servedPath.endsWith('.js')) {
    candidates.push(`src/${asset.servedPath.slice('/dist/'.length, -'.js'.length)}.ts`);
  }
  candidates.push(asset.repositoryPath);
  return [...new Set(candidates)];
}

function mappedSource(cwd, asset, base, head) {
  for (const path of sourceCandidates(asset)) {
    if (gitObjectExists(cwd, head, path) || gitObjectExists(cwd, base, path)) return path;
  }
  return null;
}

function changedBetween(cwd, path, base, head) {
  const baseBlob = gitBlob(cwd, base, path);
  const headBlob = gitBlob(cwd, head, path);
  if (!baseBlob && !headBlob) return false;
  return baseBlob !== headBlob;
}

function assetMap(html) {
  return new Map(directAssetsFromHtml(html).map((asset) => [asset.servedPath, asset]));
}

export function verifyDirectAssetCacheBust({ cwd = process.cwd(), base, head }) {
  const baseHtml = gitText(cwd, base, 'index.html');
  const headHtml = gitText(cwd, head, 'index.html');
  if (baseHtml === null) throw new Error(`No se pudo leer index.html en BASE ${base}.`);
  if (headHtml === null) throw new Error(`No se pudo leer index.html en HEAD ${head}.`);

  const baseAssets = assetMap(baseHtml);
  const headAssets = directAssetsFromHtml(headHtml);
  const violations = [];

  for (const headAsset of headAssets) {
    if (!headAsset.versioned) continue;
    if (!headAsset.version) {
      violations.push(`CACHE-BUST BLOQUEADO: ${headAsset.servedPath} usa ?v= vacío; el servidor lo trataría como immutable.`);
      continue;
    }

    const baseAsset = baseAssets.get(headAsset.servedPath);
    const sourcePath = mappedSource(cwd, headAsset, base, head);
    if (!baseAsset) {
      if (!sourcePath || !gitObjectExists(cwd, head, sourcePath)) {
        violations.push(`CACHE-BUST BLOQUEADO: ${headAsset.servedPath} es un asset directo nuevo pero no tiene contenido fuente verificable en HEAD.`);
      }
      continue; // Asset directo nuevo: su URL versionada nace junto con el contenido.
    }

    if (!sourcePath) {
      violations.push(`CACHE-BUST BLOQUEADO: no se pudo mapear el contenido fuente de ${headAsset.servedPath} para verificar ?v=${headAsset.version}.`);
      continue;
    }

    if (!changedBetween(cwd, sourcePath, base, head)) continue;
    if (baseAsset.version !== headAsset.version) continue;

    violations.push(`CACHE-BUST BLOQUEADO: ${sourcePath} cambió pero ${headAsset.servedPath} conserva ?v=${headAsset.version}`);
  }

  return {
    ok: violations.length === 0,
    violations,
    inspected: headAssets.filter((asset) => asset.versioned).length,
  };
}

function argumentValue(args, name) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function comparisonFromGitHubEvent() {
  const eventName = process.env.GITHUB_EVENT_NAME || '';
  if (eventName === 'schedule' || eventName === 'workflow_dispatch') {
    return { skip: `CACHE-BUST: ${eventName} no representa un diff de publicación; verificación comparativa omitida.` };
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH no está disponible para resolver BASE/HEAD.');
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));

  if (eventName === 'pull_request') {
    const base = event?.pull_request?.base?.sha;
    const head = event?.pull_request?.head?.sha;
    if (!base || !head) throw new Error('El evento pull_request no contiene base.sha/head.sha.');
    return { base, head };
  }

  if (eventName === 'push') {
    const base = event?.before;
    const head = event?.after || process.env.GITHUB_SHA;
    if (!head) throw new Error('El evento push no contiene HEAD.');
    if (!base || /^0+$/.test(base)) {
      return { skip: 'CACHE-BUST: push sin BASE comparable (before vacío/cero); verificación comparativa omitida.' };
    }
    return { base, head };
  }

  return { skip: `CACHE-BUST: evento ${eventName || 'desconocido'} sin contrato de diff de publicación; verificación comparativa omitida.` };
}

function runCli() {
  const args = process.argv.slice(2);
  let comparison;
  if (args.includes('--ci')) comparison = comparisonFromGitHubEvent();
  else {
    const base = argumentValue(args, '--base');
    const head = argumentValue(args, '--head');
    if (!base || !head) throw new Error('Uso: verify-direct-asset-cache-bust.mjs --base <ref> --head <ref> | --ci');
    comparison = { base, head };
  }

  if ('skip' in comparison) {
    console.log(comparison.skip);
    return;
  }

  const result = verifyDirectAssetCacheBust({ cwd: process.cwd(), base: comparison.base, head: comparison.head });
  if (!result.ok) {
    for (const violation of result.violations) console.error(violation);
    process.exitCode = 1;
    return;
  }
  console.log(`CACHE-BUST OK: ${result.inspected} assets directos versionados verificados entre ${comparison.base} y ${comparison.head}.`);
}

const invokedAsScript = Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedAsScript) {
  try {
    runCli();
  } catch (error) {
    console.error(`CACHE-BUST ERROR: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
