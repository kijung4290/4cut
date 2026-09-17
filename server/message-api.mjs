import 'dotenv/config';
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const generatedDir = resolve('generated');
const requestLog = new Map();
mkdirSync(generatedDir, { recursive: true });

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readBody(req, maxBytes = 1_200_000) {
  return new Promise((resolveBody, reject) => {
    let size = 0; const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error('사진 데이터가 너무 큽니다.')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('요청 형식이 올바르지 않습니다.')); }
    });
    req.on('error', reject);
  });
}

function rateLimited(req) {
  const key = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (requestLog.get(key) || []).filter(t => now - t < 60_000);
  recent.push(now); requestLog.set(key, recent);
  return recent.length > 5;
}

function cleanupOldFiles() {
  const cutoff = Date.now() - 86_400_000;
  for (const name of readdirSync(generatedDir)) {
    const file = join(generatedDir, name);
    try { if (statSync(file).mtimeMs < cutoff) unlinkSync(file); } catch {}
  }
}

export async function handleApi(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'POST 요청만 허용됩니다.' });
  if (rateLimited(req)) return json(res, 429, { error: '잠시 후 다시 시도해 주세요.' });
  const apiKey = process.env.MESSAGEME_API_KEY;
  const callback = (process.env.MESSAGEME_CALLBACK || '').replace(/\D/g, '');
  const publicBaseUrl = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (!apiKey || !callback || !publicBaseUrl) return json(res, 503, { error: '문자 발송 설정이 아직 완료되지 않았습니다. 관리자에게 문의해 주세요.' });

  try {
    const { phone, imageData } = await readBody(req);
    const dstaddr = String(phone || '').replace(/\D/g, '');
    if (!/^01[016789]\d{7,8}$/.test(dstaddr)) return json(res, 400, { error: '휴대폰 번호를 정확히 입력해 주세요.' });
    const match = String(imageData || '').match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return json(res, 400, { error: 'JPG 사진 데이터가 필요합니다.' });
    const image = Buffer.from(match[1], 'base64');
    if (image.length > 500_000) return json(res, 400, { error: '전송용 사진은 500KB 이하여야 합니다.' });

    cleanupOldFiles();
    const filename = `${randomUUID()}.jpg`;
    writeFileSync(join(generatedDir, filename), image, { flag: 'wx' });
    const form = new URLSearchParams({
      api_key: apiKey,
      msg: process.env.MESSAGEME_TEXT || '오늘 촬영한 우리의 네컷 사진입니다.',
      subject: process.env.MESSAGEME_SUBJECT || '우리의 네컷',
      callback,
      dstaddr,
      image: `${publicBaseUrl}/generated/${filename}`,
      send_reserve: '0',
      call_block: '0'
    });
    const response = await fetch(process.env.MESSAGEME_API_URL || 'http://221.139.14.136/APIV2/API/sms_send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: form,
      signal: AbortSignal.timeout(15_000)
    });
    const result = await response.text();
    if (!response.ok || /fail|error|실패/i.test(result)) throw new Error('메세지미에서 발송을 접수하지 못했습니다.');
    return json(res, 200, { ok: true, message: '문자 발송을 접수했습니다.' });
  } catch (error) {
    console.error('[MessageMe]', error.message);
    return json(res, 502, { error: error.message || '문자 발송 중 오류가 발생했습니다.' });
  }
}

export function serveGenerated(req, res, next) {
  const name = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, '');
  if (!/^[a-f0-9-]+\.jpg$/i.test(name)) return next?.() || json(res, 404, { error: '사진을 찾을 수 없습니다.' });
  const file = join(generatedDir, name);
  if (!existsSync(file) || extname(file) !== '.jpg') return next?.() || json(res, 404, { error: '사진을 찾을 수 없습니다.' });
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  createReadStream(file).pipe(res);
}
