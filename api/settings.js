import { list, put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';

const CONFIG_PREFIX = 'fourcut/config/';
const requests = new Map();

function rateLimited(req) {
  const key = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0];
  const now = Date.now();
  const recent = (requests.get(key) || []).filter(time => now - time < 60_000);
  recent.push(now);
  requests.set(key, recent);
  return recent.length > 12;
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function text(value, maxLength, fallback = '') {
  return typeof value === 'string' ? value.slice(0, maxLength) : fallback;
}

function color(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback;
}

function parseImageDataUrl(value) {
  const match = String(value || '').match(/^data:(image\/(?:gif|jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 2_000_000) throw new Error('저장할 이미지 한 개는 압축 후 2MB 이하여야 합니다.');
  return { contentType: match[1], buffer };
}

function safeExistingAsset(value) {
  if (value === null || typeof value === 'undefined' || value === '') return null;
  if (value === '/default-pose-guide.gif') return value;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname.endsWith('.public.blob.vercel-storage.com')) return url.href;
  } catch {}
  throw new Error('허용되지 않은 이미지 주소입니다.');
}

async function storeAsset(value, label) {
  const image = parseImageDataUrl(value);
  if (!image) return safeExistingAsset(value);
  const extension = image.contentType.split('/')[1].replace('jpeg', 'jpg');
  const blob = await put(`fourcut/assets/${Date.now()}-${randomUUID()}-${label}.${extension}`, image.buffer, {
    access: 'public',
    contentType: image.contentType,
    addRandomSuffix: false,
    cacheControlMaxAge: 31_536_000
  });
  return blob.url;
}

async function latestSettings() {
  const result = await list({ prefix: CONFIG_PREFIX, limit: 1000 });
  if (!result.blobs.length) return null;
  const latest = [...result.blobs].sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0];
  const response = await fetch(latest.url, { cache: 'no-store' });
  if (!response.ok) throw new Error('저장된 설정을 읽지 못했습니다.');
  return response.json();
}

function normalizeSettings(input, assets) {
  const allowedTemplates = new Set(['blue', 'peach', 'midnight', 'mint', 'custom']);
  return {
    templateId: allowedTemplates.has(input.templateId) ? input.templateId : 'blue',
    bg: color(input.bg, '#2155e8'),
    ink: color(input.ink, '#ffffff'),
    accent: color(input.accent, '#ffb083'),
    orgName: text(input.orgName, 22, '우리 기관'),
    tagline: text(input.tagline, 30, '함께여서 더 빛난 오늘'),
    logo: assets.logo,
    backgroundImage: assets.backgroundImage,
    backgroundOpacity: clamp(input.backgroundOpacity, .1, 1, .45),
    guideGif: input.guideGif === null ? null : (assets.guideGif || '/default-pose-guide.gif'),
    removeGifBackground: input.removeGifBackground !== false,
    guideGifScale: clamp(input.guideGifScale, 50, 250, 100),
    guideGifX: clamp(input.guideGifX, 0, 100, 81),
    guideGifY: clamp(input.guideGifY, 0, 100, 50)
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  try {
    if (req.method === 'GET') {
      const record = await latestSettings();
      return res.status(200).json(record || { settings: null, updatedAt: null });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'GET 또는 POST 요청만 허용됩니다.' });
    if (rateLimited(req)) return res.status(429).json({ error: '저장 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' });

    const input = req.body?.settings;
    if (!input || typeof input !== 'object') return res.status(400).json({ error: '저장할 설정이 필요합니다.' });
    const assets = {
      guideGif: await storeAsset(input.guideGif, 'guide'),
      backgroundImage: await storeAsset(input.backgroundImage, 'background'),
      logo: await storeAsset(input.logo, 'logo')
    };
    const settings = normalizeSettings(input, assets);
    const record = { settings, updatedAt: new Date().toISOString() };
    await put(`${CONFIG_PREFIX}${Date.now()}-${randomUUID()}.json`, JSON.stringify(record), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      cacheControlMaxAge: 31_536_000
    });
    return res.status(200).json(record);
  } catch (error) {
    console.error('[Fourcut settings]', error.message);
    return res.status(500).json({ error: error.message || '설정을 저장하지 못했습니다.' });
  }
}
