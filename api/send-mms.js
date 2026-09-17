import { put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';

const requests = new Map();

function limited(req) {
  const key = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0];
  const now = Date.now();
  const recent = (requests.get(key) || []).filter(time => now - time < 60_000);
  recent.push(now);
  requests.set(key, recent);
  return recent.length > 5;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
  if (limited(req)) return res.status(429).json({ error: '잠시 후 다시 시도해 주세요.' });

  const apiKey = process.env.MESSAGEME_API_KEY;
  const callback = String(process.env.MESSAGEME_CALLBACK || '').replace(/\D/g, '');
  if (!apiKey) return res.status(503).json({ error: 'MESSAGEME_API_KEY가 등록되지 않았습니다.' });
  if (!callback) return res.status(503).json({ error: 'MESSAGEME_CALLBACK 발신번호가 등록되지 않았습니다.' });

  try {
    const dstaddr = String(req.body?.phone || '').replace(/\D/g, '');
    if (!/^01[016789]\d{7,8}$/.test(dstaddr)) return res.status(400).json({ error: '휴대폰 번호를 정확히 입력해 주세요.' });

    const match = String(req.body?.imageData || '').match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return res.status(400).json({ error: 'JPG 사진 데이터가 필요합니다.' });
    const image = Buffer.from(match[1], 'base64');
    if (image.length > 500_000) return res.status(400).json({ error: '전송용 사진은 500KB 이하여야 합니다.' });

    let blob;
    try {
      blob = await put(`fourcut/${randomUUID()}.jpg`, image, {
        access: 'public',
        contentType: 'image/jpeg',
        addRandomSuffix: false,
        cacheControlMaxAge: 86400
      });
    } catch (error) {
      console.error('[Vercel Blob]', error.message);
      return res.status(503).json({ error: 'Vercel Blob이 프로젝트에 연결되지 않았습니다.' });
    }

    const form = new URLSearchParams({
      api_key: apiKey,
      msg: process.env.MESSAGEME_TEXT || '오늘 촬영한 우리의 네컷 사진입니다.',
      subject: process.env.MESSAGEME_SUBJECT || '우리의 네컷',
      callback,
      dstaddr,
      image: blob.url,
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
    return res.status(200).json({ ok: true, message: '문자 발송을 접수했습니다.' });
  } catch (error) {
    console.error('[MessageMe]', error.message);
    return res.status(502).json({ error: error.message || '문자 발송 중 오류가 발생했습니다.' });
  }
}
