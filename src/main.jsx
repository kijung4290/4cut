import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Camera, Check, ChevronLeft, ChevronRight, Download, ImagePlus,
  Mail, MessageCircle, Move, RefreshCw, Sparkles, Upload, X, Save, Home
} from 'lucide-react';
import { decode, decodeFrames, encode } from 'modern-gif';
import gifWorkerUrl from 'modern-gif/worker?url';
import './styles.css';

const templates = [
  { id: 'blue', name: '파란 하루', bg: '#2155e8', ink: '#ffffff', accent: '#ffb083', marks: ['✦', '●', '✦'] },
  { id: 'peach', name: '살구빛 미소', bg: '#ffb083', ink: '#172255', accent: '#fff8ee', marks: ['♥', '·', '♥'] },
  { id: 'midnight', name: '밤의 기록', bg: '#151a2d', ink: '#ffffff', accent: '#b8f357', marks: ['★', '✦', '★'] },
  { id: 'mint', name: '초록 산책', bg: '#b9eadc', ink: '#164239', accent: '#ff6d5a', marks: ['●', '✿', '●'] },
];

const STEPS = ['촬영', '사진 선택', '전송'];
const DEFAULT_GUIDE_GIF = '/default-pose-guide.gif';
const GUIDE_PLACEMENT = { x: 0.64, y: 0.08, width: 0.34, height: 0.84 };
const MAX_GIF_UPLOAD_BYTES = 40 * 1024 * 1024;
const TARGET_GIF_BYTES = 900 * 1024;
const MAX_DECODED_GIF_BYTES = 220 * 1024 * 1024;
const DEFAULT_SETTINGS = {
  templateId: 'blue',
  bg: '#2155e8',
  ink: '#ffffff',
  accent: '#ffb083',
  orgName: '우리 기관',
  tagline: '함께여서 더 빛난 오늘',
  logo: null,
  backgroundImage: null,
  backgroundOpacity: 0.45,
  guideGif: DEFAULT_GUIDE_GIF,
  removeGifBackground: true,
  guideGifScale: 100,
  guideGifX: 81,
  guideGifY: 50
};
let shotSequence = 0;

function createShot(src) {
  shotSequence += 1;
  return { id: `shot-${Date.now()}-${shotSequence}`, src };
}

function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('fourcut-settings') || '{}') }; }
  catch { return DEFAULT_SETTINGS; }
}

function AdminPage() {
  const adminVideoRef = useRef(null);
  const adminStreamRef = useRef(null);
  const adminViewfinderRef = useRef(null);
  const draggingGuideRef = useRef(false);
  const guideDragOffsetRef = useRef({ x: 0, y: 0 });
  const [settings, setSettings] = useState(loadSettings);
  const [saved, setSaved] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [gifBusy, setGifBusy] = useState(false);
  const [gifStatus, setGifStatus] = useState('');
  const [previewMode, setPreviewMode] = useState('camera');
  const [adminCameraError, setAdminCameraError] = useState('');

  useEffect(() => {
    startAdminCamera();
    return stopAdminCamera;
  }, []);

  async function startAdminCamera() {
    stopAdminCamera();
    setAdminCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false
      });
      adminStreamRef.current = stream;
      if (adminVideoRef.current) adminVideoRef.current.srcObject = stream;
      else stream.getTracks().forEach(track => track.stop());
    } catch {
      setAdminCameraError('카메라 권한을 허용하면 실제 촬영 화면에서 위치를 조정할 수 있습니다.');
    }
  }

  function stopAdminCamera() {
    adminStreamRef.current?.getTracks().forEach(track => track.stop());
    adminStreamRef.current = null;
  }

  function updateGuidePosition(event) {
    const rect = adminViewfinderRef.current?.getBoundingClientRect();
    if (!rect) return;
    const pointerX = ((event.clientX - rect.left) / rect.width) * 100;
    const pointerY = ((event.clientY - rect.top) / rect.height) * 100;
    const x = Math.max(0, Math.min(100, pointerX - guideDragOffsetRef.current.x));
    const y = Math.max(0, Math.min(100, pointerY - guideDragOffsetRef.current.y));
    setSettings(prev => ({ ...prev, guideGifX: Math.round(x), guideGifY: Math.round(y) }));
  }

  function beginGuideDrag(event) {
    event.preventDefault();
    draggingGuideRef.current = true;
    const rect = adminViewfinderRef.current?.getBoundingClientRect();
    if (rect) {
      guideDragOffsetRef.current = {
        x: ((event.clientX - rect.left) / rect.width) * 100 - settings.guideGifX,
        y: ((event.clientY - rect.top) / rect.height) * 100 - settings.guideGifY
      };
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    updateGuidePosition(event);
  }

  function moveGuide(event) {
    if (draggingGuideRef.current) updateGuidePosition(event);
  }

  function endGuideDrag() {
    draggingGuideRef.current = false;
  }

  function chooseTemplate(base) {
    setSettings(prev => ({ ...prev, templateId: base.id, bg: base.bg, ink: base.ink, accent: base.accent }));
  }

  function loadAdminLogo(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => setSettings(prev => ({ ...prev, logo: e.target.result }));
    reader.readAsDataURL(file);
  }

  async function loadBackgroundImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const resized = await resizeImageFile(file, 1200, 1800, 0.82);
    setSettings(prev => ({ ...prev, backgroundImage: resized }));
    event.target.value = '';
  }

  async function loadGuideGif(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setSettingsError('');
    setGifStatus('');
    if (file.type !== 'image/gif' && !file.name.toLowerCase().endsWith('.gif')) {
      setSettingsError('움직이는 GIF 파일만 올릴 수 있습니다.');
      event.target.value = '';
      return;
    }
    if (file.size > MAX_GIF_UPLOAD_BYTES) {
      setSettingsError('원본 GIF는 최대 40MB까지 올릴 수 있습니다.');
      event.target.value = '';
      return;
    }
    event.target.value = '';
    setGifBusy(true);
    setGifStatus('GIF 분석 중…');
    try {
      const result = await compressGuideGif(file, settings.removeGifBackground, message => setGifStatus(message));
      const dataUrl = await blobToDataUrl(result.blob);
      setSettings(prev => ({ ...prev, guideGif: dataUrl }));
      setGifStatus(`${formatBytes(file.size)} → ${formatBytes(result.blob.size)}로 압축 완료 · 설정 저장을 눌러 주세요.`);
    } catch (error) {
      setGifStatus('');
      setSettingsError(error.message || 'GIF를 압축하지 못했습니다. 다른 파일로 다시 시도해 주세요.');
    } finally {
      setGifBusy(false);
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem('fourcut-settings', JSON.stringify(settings));
      setSettingsError('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch {
      setSettingsError('저장 공간이 부족합니다. GIF 또는 배경 이미지의 용량을 줄여 주세요.');
    }
  }

  const adminGuidePlacement = getGuidePlacement(settings.guideGifScale, settings.guideGifX, settings.guideGifY);
  const adminGuideStyle = getGuideStyle(adminGuidePlacement);

  return <main className="admin-page">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Sparkles size={21}/></span><span>네컷 관리자</span></div>
      <a className="home-link" href="/"><Home size={17}/> 촬영 화면</a>
    </header>
    <section className="admin-workspace">
      <div className="admin-heading"><p className="eyebrow">ADMIN · FRAME STUDIO</p><h1>네컷 프레임 설정</h1><p>여기서 저장한 디자인이 메인 촬영 화면에 적용됩니다.</p></div>
      <div className="admin-grid">
        <div className="admin-preview-shell">
          <div className="admin-preview-tabs" role="tablist" aria-label="미리보기 선택">
            <button type="button" className={previewMode === 'camera' ? 'active' : ''} onClick={() => setPreviewMode('camera')}><Camera size={15}/> 실제 카메라</button>
            <button type="button" className={previewMode === 'frame' ? 'active' : ''} onClick={() => setPreviewMode('frame')}><ImagePlus size={15}/> 네컷 프레임</button>
          </div>
          <div className={`admin-live-preview ${previewMode !== 'camera' ? 'preview-pane-hidden' : ''}`}>
            <div ref={adminViewfinderRef} className="admin-live-viewfinder">
              <video ref={adminVideoRef} autoPlay playsInline muted/>
              {settings.guideGif && <img
                className="admin-draggable-gif"
                src={settings.guideGif}
                style={adminGuideStyle}
                alt="촬영 GIF 위치 미리보기"
                draggable={false}
                onPointerDown={beginGuideDrag}
                onPointerMove={moveGuide}
                onPointerUp={endGuideDrag}
                onPointerCancel={endGuideDrag}
              />}
              <span className="admin-preview-badge"><Move size={13}/> GIF를 끌어 이동</span>
              {adminCameraError && <div className="admin-camera-error"><Camera size={28}/><p>{adminCameraError}</p><button type="button" onClick={startAdminCamera}>다시 연결</button></div>}
            </div>
            <p><b>실제 촬영 미리보기</b><span>GIF를 직접 끌거나 오른쪽 슬라이더로 조정하세요.</span></p>
          </div>
          <div className={`admin-preview ${previewMode !== 'frame' ? 'preview-pane-hidden' : ''}`} style={{'--frame-bg': settings.bg, '--frame-ink': settings.ink, '--frame-accent': settings.accent}}>
            <div className="admin-strip" style={settings.backgroundImage ? {backgroundImage:`linear-gradient(rgba(0,0,0,${1-settings.backgroundOpacity}),rgba(0,0,0,${1-settings.backgroundOpacity})), url(${settings.backgroundImage})`} : undefined}><b>FOUR MOMENTS</b>{[1,2,3,4].map(n => <span key={n}>PHOTO {n}</span>)}<div><strong>{settings.orgName || '우리 기관'}</strong><small>{settings.tagline || '함께여서 더 빛난 오늘'}</small>{settings.logo ? <img src={settings.logo} alt="기관 로고"/> : <i>LOGO</i>}</div></div>
          </div>
        </div>
        <div className="admin-controls">
          <fieldset><legend>기본 템플릿</legend><div className="template-grid">
            {templates.map(t => <button key={t.id} onClick={() => chooseTemplate(t)} className={`template-swatch ${t.id === settings.templateId ? 'selected' : ''}`} style={{'--swatch': t.bg, '--ink': t.ink}}><span className="swatch-preview"><i/><i/><i/><i/></span><b>{t.name}</b>{t.id === settings.templateId && <Check size={16}/>}</button>)}
          </div></fieldset>
          <fieldset><legend>프레임 색상 세부 설정</legend><div className="color-fields">
            {[['bg','배경'],['ink','글자'],['accent','포인트']].map(([key,label]) => <label key={key}><span>{label}</span><input type="color" value={settings[key]} onChange={e => setSettings(prev => ({...prev, [key]: e.target.value, templateId: 'custom'}))}/><code>{settings[key]}</code></label>)}
          </div></fieldset>
          <fieldset><legend>프레임 배경 이미지</legend>
            <div className="background-upload-row"><label className="logo-upload"><ImagePlus size={18}/><span>{settings.backgroundImage ? '배경 이미지 바꾸기' : '배경 이미지 올리기'}<small>JPG, PNG · 자동 축소</small></span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={loadBackgroundImage}/></label>{settings.backgroundImage && <button className="icon-button" onClick={() => setSettings(prev => ({...prev, backgroundImage:null}))} aria-label="배경 이미지 삭제"><X size={18}/></button>}</div>
            {settings.backgroundImage && <label className="opacity-field"><span>이미지 선명도</span><input type="range" min="10" max="100" value={Math.round(settings.backgroundOpacity*100)} onChange={e => setSettings(prev => ({...prev, backgroundOpacity:Number(e.target.value)/100}))}/><b>{Math.round(settings.backgroundOpacity*100)}%</b></label>}
          </fieldset>
          <fieldset><legend>촬영 가이드 GIF</legend>
            <p className="field-help">카메라 화면 오른쪽에서 움직이며 촬영 사진에도 함께 들어갑니다. 큰 파일은 기기 안에서 자동 압축되어 잠시 시간이 걸릴 수 있습니다.</p>
            <label className="background-removal-toggle"><input type="checkbox" checked={settings.removeGifBackground} onChange={e => setSettings(prev => ({...prev, removeGifBackground:e.target.checked}))}/><span><b>흰 배경 자동 제거</b><small>가장자리와 연결된 흰색만 투명하게 처리합니다.</small></span></label>
            <div className="guide-settings-row">
              {settings.guideGif && <div className="guide-admin-preview"><img src={settings.guideGif} alt="촬영 가이드 미리보기" style={{transform:`scale(${settings.guideGifScale / 100})`}}/><span>미리보기</span></div>}
              <div className="guide-setting-actions">
                <label className={`logo-upload ${gifBusy ? 'is-busy' : ''}`} aria-busy={gifBusy}><Sparkles size={18}/><span>{gifBusy ? 'GIF 압축 중…' : settings.guideGif ? 'GIF 바꾸기' : 'GIF 올리기'}<small>원본 GIF 최대 40MB · 자동 압축</small></span><input type="file" accept="image/gif" onChange={loadGuideGif} disabled={gifBusy}/></label>
                <div className="guide-mini-actions">
                  <button type="button" onClick={() => setSettings(prev => ({...prev, guideGif: DEFAULT_GUIDE_GIF}))}>기본 GIF</button>
                  {settings.guideGif && <button type="button" onClick={() => setSettings(prev => ({...prev, guideGif:null}))}>표시 안 함</button>}
                </div>
              </div>
            </div>
            <div className="gif-layout-controls">
              <label className="gif-scale-control"><span>GIF 크기</span><input type="range" min="50" max="180" step="5" value={settings.guideGifScale} onChange={e => setSettings(prev => ({...prev, guideGifScale:Number(e.target.value)}))}/><b>{settings.guideGifScale}%</b></label>
              <label className="gif-scale-control"><span>가로 위치</span><input type="range" min="0" max="100" value={settings.guideGifX} onChange={e => setSettings(prev => ({...prev, guideGifX:Number(e.target.value)}))}/><b>{settings.guideGifX}%</b></label>
              <label className="gif-scale-control"><span>세로 위치</span><input type="range" min="0" max="100" value={settings.guideGifY} onChange={e => setSettings(prev => ({...prev, guideGifY:Number(e.target.value)}))}/><b>{settings.guideGifY}%</b></label>
              <button type="button" className="reset-gif-layout" onClick={() => setSettings(prev => ({...prev, guideGifScale:100, guideGifX:81, guideGifY:50}))}><RefreshCw size={14}/> 위치·크기 초기화</button>
            </div>
            {gifStatus && <p className="gif-status" role="status">{gifStatus}</p>}
            {settingsError && <p className="settings-error" role="alert">{settingsError}</p>}
          </fieldset>
          <fieldset><legend>기관 정보</legend>
            <label className="text-field"><span>기관명</span><input value={settings.orgName} maxLength={22} onChange={e => setSettings(prev => ({...prev, orgName:e.target.value}))}/></label>
            <label className="text-field admin-tagline"><span>하단 문구</span><input value={settings.tagline} maxLength={30} onChange={e => setSettings(prev => ({...prev, tagline:e.target.value}))}/></label>
            <div className="logo-row"><label className="logo-upload"><Upload size={18}/><span>{settings.logo ? '로고 바꾸기' : '기관 로고 올리기'}<small>PNG, JPG 권장</small></span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={loadAdminLogo}/></label>{settings.logo && <button className="icon-button" onClick={() => setSettings(prev => ({...prev, logo:null}))} aria-label="로고 삭제"><X size={18}/></button>}</div>
          </fieldset>
          <button className="save-settings" onClick={saveSettings} disabled={gifBusy}><Save size={19}/>{saved ? '저장되었습니다' : '설정 저장하기'}</button>
        </div>
      </div>
    </section>
  </main>;
}

function App() {
  const videoRef = useRef(null);
  const guideGifRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [step, setStep] = useState(0);
  const [shots, setShots] = useState([]);
  const [selected, setSelected] = useState([]);
  const [settings] = useState(loadSettings);
  const [template] = useState(() => ({ ...templates.find(t => t.id === settings.templateId) || templates[0], bg: settings.bg, ink: settings.ink, accent: settings.accent }));
  const [logo] = useState(settings.logo);
  const [orgName] = useState(settings.orgName);
  const [countdown, setCountdown] = useState(null);
  const [cameraError, setCameraError] = useState('');
  const [toast, setToast] = useState('');
  const [facingMode, setFacingMode] = useState('user');
  const [finalUrl, setFinalUrl] = useState('');
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (step === 0) startCamera();
    return stopCamera;
  }, [step, facingMode]);

  useEffect(() => {
    if (step >= 2) renderStrip();
  }, [step, selected, template, logo, orgName]);

  useEffect(() => () => finalUrl && URL.revokeObjectURL(finalUrl), [finalUrl]);

  const flashToast = (message) => {
    setToast(message);
    window.clearTimeout(window.__toastTimer);
    window.__toastTimer = window.setTimeout(() => setToast(''), 2600);
  };

  async function startCamera() {
    stopCamera();
    setCameraError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      setCameraError('카메라를 열 수 없습니다. 권한을 허용하거나 아래에서 사진을 불러와 주세요.');
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  }

  function snap() {
    if (!videoRef.current?.videoWidth) return flashToast('카메라가 준비될 때까지 잠시 기다려 주세요.');
    let n = 3;
    setCountdown(n);
    const timer = setInterval(() => {
      n -= 1;
      if (n > 0) return setCountdown(n);
      clearInterval(timer);
      setCountdown('찰칵!');
      const v = videoRef.current;
      const c = document.createElement('canvas');
      c.width = 900; c.height = 675;
      const ctx = c.getContext('2d');
      ctx.save();
      ctx.translate(c.width, 0); ctx.scale(-1, 1);
      drawCover(ctx, v, 0, 0, c.width, c.height);
      ctx.restore();
      const guide = guideGifRef.current;
      if (settings.guideGif && guide?.complete && guide.naturalWidth) {
        const placement = getGuidePlacement(settings.guideGifScale, settings.guideGifX, settings.guideGifY);
        drawContain(
          ctx,
          guide,
          c.width * placement.x,
          c.height * placement.y,
          c.width * placement.width,
          c.height * placement.height
        );
      }
      const data = c.toDataURL('image/jpeg', .92);
      setShots(prev => [...prev, createShot(data)]);
      setTimeout(() => setCountdown(null), 450);
    }, 850);
  }

  function loadPhotos(event) {
    const files = [...event.target.files].filter(f => f.type.startsWith('image/'));
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = e => setShots(prev => [...prev, createShot(e.target.result)]);
      reader.readAsDataURL(file);
    });
    event.target.value = '';
  }

  function togglePhoto(photo) {
    setSelected(prev => prev.some(item => item.id === photo.id)
      ? prev.filter(item => item.id !== photo.id)
      : prev.length < 4 ? [...prev, photo] : prev);
  }

  function loadLogo(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => setLogo(e.target.result);
    reader.readAsDataURL(file);
  }

  async function renderStrip() {
    const canvas = canvasRef.current;
    if (!canvas || selected.length !== 4) return;
    const ctx = canvas.getContext('2d');
    const W = 900, H = 2700, pad = 70, photoW = 760, photoH = 495, gap = 28;
    canvas.width = W; canvas.height = H;
    ctx.fillStyle = template.bg; ctx.fillRect(0, 0, W, H);
    if (settings.backgroundImage) {
      const background = await loadImage(settings.backgroundImage);
      ctx.save();
      ctx.globalAlpha = settings.backgroundOpacity;
      drawCover(ctx, background, 0, 0, W, H);
      ctx.restore();
    }
    ctx.fillStyle = template.accent;
    ctx.beginPath(); ctx.arc(74, 74, 22, 0, Math.PI * 2); ctx.fill();
    ctx.font = '700 24px sans-serif'; ctx.textAlign = 'right';
    ctx.fillStyle = template.ink; ctx.fillText('FOUR MOMENTS', W - 70, 82);

    for (let i = 0; i < 4; i++) {
      const img = await loadImage(selected[i].src);
      const y = 128 + i * (photoH + gap);
      ctx.save();
      roundedRect(ctx, pad, y, photoW, photoH, 16); ctx.clip();
      drawCover(ctx, img, pad, y, photoW, photoH); ctx.restore();
    }

    const footY = 2260;
    ctx.textAlign = 'left'; ctx.fillStyle = template.ink;
    ctx.font = '800 64px "Arial", sans-serif';
    ctx.fillText(orgName.trim() || '우리 기관', 70, footY + 96);
    ctx.font = '500 30px sans-serif';
    const date = new Intl.DateTimeFormat('ko-KR', { year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
    ctx.fillText(`${settings.tagline || '함께여서 더 빛난 오늘'}  ·  ${date}`, 72, footY + 150);
    ctx.textAlign = 'right'; ctx.font = '700 42px sans-serif';
    ctx.fillStyle = template.accent; ctx.fillText(template.marks.join('  '), W - 70, footY + 145);

    if (logo) {
      const logoImg = await loadImage(logo);
      const boxW = 290, boxH = 150, x = W - 360, y = footY + 220;
      ctx.fillStyle = '#ffffff'; roundedRect(ctx, x, y, boxW, boxH, 18); ctx.fill();
      drawContain(ctx, logoImg, x + 20, y + 18, boxW - 40, boxH - 36);
    } else {
      ctx.globalAlpha = .7; ctx.strokeStyle = template.ink; ctx.setLineDash([10, 10]); ctx.lineWidth = 3;
      roundedRect(ctx, W - 360, footY + 220, 290, 150, 18); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = template.ink; ctx.textAlign = 'center'; ctx.font = '500 26px sans-serif';
      ctx.fillText('기관 로고 영역', W - 215, footY + 307); ctx.globalAlpha = 1;
    }
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .94));
    if (finalUrl) URL.revokeObjectURL(finalUrl);
    setFinalUrl(URL.createObjectURL(blob));
  }

  async function getFile() {
    const blob = await new Promise(resolve => canvasRef.current.toBlob(resolve, 'image/jpeg', .94));
    return new File([blob], `우리의네컷_${Date.now()}.jpg`, { type: 'image/jpeg' });
  }

  async function sharePhoto(kind) {
    const file = await getFile();
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: '우리의 네컷',
          text: kind === 'sms' ? '오늘 찍은 네컷 사진이에요 💙' : '함께 찍은 네컷 사진을 보냅니다.'
        });
        flashToast('공유 앱을 열었습니다.');
      } catch (e) {
        if (e.name !== 'AbortError') downloadPhoto();
      }
    } else {
      downloadPhoto();
      flashToast('JPG를 저장했습니다. 메일이나 문자에 첨부해 주세요.');
    }
  }

  async function sendMms() {
    const normalized = phone.replace(/\D/g, '');
    if (!/^01[016789]\d{7,8}$/.test(normalized)) return flashToast('휴대폰 번호를 정확히 입력해 주세요.');
    setSending(true);
    try {
      const imageData = await makeMmsImage();
      const response = await fetch('/api/send-mms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normalized, imageData })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '문자를 보내지 못했습니다.');
      flashToast('문자 발송을 접수했습니다.');
    } catch (error) {
      flashToast(error.message);
    } finally {
      setSending(false);
    }
  }

  async function makeMmsImage() {
    const source = canvasRef.current;
    const canvas = document.createElement('canvas');
    // 네컷 원본 비율(1:3)을 유지한 채 MMS 용량만 줄인다.
    canvas.width = 720;
    canvas.height = 2160;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    for (let quality = .86; quality >= .38; quality -= .06) {
      const data = canvas.toDataURL('image/jpeg', quality);
      if (Math.ceil((data.length - 23) * 3 / 4) < 480_000) return data;
    }

    // 사진이 매우 복잡해도 비율은 그대로 유지하고 해상도만 한 단계 낮춘다.
    canvas.width = 540;
    canvas.height = 1620;
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    for (let quality = .48; quality >= .2; quality -= .04) {
      const data = canvas.toDataURL('image/jpeg', quality);
      if (Math.ceil((data.length - 23) * 3 / 4) < 480_000) return data;
    }
    return canvas.toDataURL('image/jpeg', .2);
  }

  function downloadPhoto() {
    const a = document.createElement('a');
    a.href = finalUrl; a.download = `우리의네컷_${Date.now()}.jpg`; a.click();
    flashToast('JPG 파일을 저장했습니다.');
  }

  function next() {
    if (step === 0 && shots.length < 4) return flashToast('사진을 4장 이상 촬영하거나 불러와 주세요.');
    if (step === 1 && selected.length !== 4) return flashToast('네컷에 넣을 사진 4장을 선택해 주세요.');
    setStep(s => Math.min(3, s + 1));
  }

  const selectedNumber = useMemo(() => new Map(selected.map((photo, i) => [photo.id, i + 1])), [selected]);
  const guidePlacement = getGuidePlacement(settings.guideGifScale, settings.guideGifX, settings.guideGifY);
  const guideStyle = getGuideStyle(guidePlacement);

  return (
    <main>
      <header className="topbar">
        <button className="brand" onClick={() => setStep(0)} aria-label="처음으로">
          <span className="brand-mark"><Sparkles size={21}/></span>
          <span>우리의 네컷</span>
        </button>
        <div className="stepper" aria-label="진행 단계">
          {STEPS.map((name, i) => <div className={`step ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`} key={name}>
            <span>{i < step ? <Check size={13}/> : i + 1}</span><b>{name}</b>
          </div>)}
        </div>
      </header>

      <section className="workspace">
        {step === 0 && <>
          <div className="intro">
            <p className="eyebrow">STEP 1 · CAMERA</p>
            <h1>지금 이 순간을<br/><em>네 번</em> 담아보세요.</h1>
            <p>마음에 드는 사진이 나올 때까지 자유롭게 촬영할 수 있어요.</p>
          </div>
          <div className="camera-card">
            <div className="camera-stage no-guide">
              <div className="viewfinder">
                <video ref={videoRef} autoPlay playsInline muted />
                {settings.guideGif && <img ref={guideGifRef} className="camera-gif-overlay" style={guideStyle} src={settings.guideGif} alt="함께 촬영되는 움직이는 캐릭터"/>}
                {settings.guideGif && <span className="composite-badge"><Sparkles size={12}/> 함께 촬영</span>}
                <span className="corner tl"/><span className="corner tr"/><span className="corner bl"/><span className="corner br"/>
                {countdown && <div className="countdown">{countdown}</div>}
                {cameraError && <div className="camera-error"><Camera size={34}/><p>{cameraError}</p></div>}
                <div className="shot-count">{shots.length}장 촬영</div>
              </div>
            </div>
            <div className="camera-actions">
              <button className="round secondary" onClick={() => setFacingMode(f => f === 'user' ? 'environment' : 'user')} aria-label="카메라 전환"><RefreshCw/></button>
              <button className="shutter" onClick={snap} aria-label="사진 촬영"><span/></button>
              <label className="round secondary file-button" aria-label="사진 불러오기"><ImagePlus/><input type="file" accept="image/*" multiple onChange={loadPhotos}/></label>
            </div>
          </div>
          {shots.length > 0 && <div className="mini-roll">{shots.map((photo, i) => <img src={photo.src} key={photo.id} alt={`${i+1}번째 촬영 사진`}/>)}</div>}
        </>}

        {step === 1 && <>
          <div className="section-head">
            <div><p className="eyebrow">STEP 2 · PICK FOUR</p><h1>네 장을 골라주세요.</h1></div>
            <div className="selection-count"><strong>{selected.length}</strong><span>/ 4</span></div>
          </div>
          <div className="photo-grid">
            {shots.map((photo, i) => <button key={photo.id} className={`photo-choice ${selectedNumber.has(photo.id) ? 'chosen' : ''}`} onClick={() => togglePhoto(photo)}>
              <img src={photo.src} alt={`${i+1}번째 후보 사진`}/>
              {selectedNumber.has(photo.id) && <span>{selectedNumber.get(photo.id)}</span>}
            </button>)}
          </div>
          <label className="inline-upload"><Upload size={18}/> 사진 더 불러오기<input type="file" accept="image/*" multiple onChange={loadPhotos}/></label>
        </>}

        {step === 2 && <div className="editor-layout">
          <div className="preview-side">
            <p className="eyebrow">STEP 3 · KEEP THE MOMENT</p>
            <div className="strip-wrap"><canvas ref={canvasRef}/>{!finalUrl && <div className="rendering">네컷을 만드는 중…</div>}</div>
          </div>
          <div className="controls-side">
            <div className="finish-copy"><span className="finish-icon"><Check/></span><p className="eyebrow">완성되었습니다</p><h1>오늘의 네컷을<br/>보내보세요.</h1><p>사진은 관리자 화면에서 설정한 기관 프레임으로 자동 완성됩니다.</p></div>
            <div className="share-actions">
              <button className="action-card email" onClick={() => sharePhoto('email')}><span><Mail/></span><div><b>메일로 보내기</b><small>메일 앱에서 받는 사람을 선택</small></div><ChevronRight/></button>
              <div className="sms-box">
                <label htmlFor="phone">휴대폰 번호</label>
                <div className="sms-input-row"><input id="phone" type="tel" inputMode="numeric" value={phone} onChange={e => setPhone(e.target.value)} placeholder="010-1234-5678"/><button onClick={sendMms} disabled={sending}><MessageCircle size={19}/>{sending ? '전송 중…' : '문자로 보내기'}</button></div>
                <small>메세지미 MMS로 사진이 전송됩니다.</small>
              </div>
              <button className="action-card download" onClick={downloadPhoto}><span><Download/></span><div><b>JPG 저장하기</b><small>기기에 고화질 파일로 저장</small></div><ChevronRight/></button>
            </div>
            <button className="restart" onClick={() => { setShots([]); setSelected([]); setStep(0); }}><RefreshCw size={17}/> 새로 촬영하기</button>
          </div>
        </div>}
      </section>

      <footer className="bottom-nav">
        <button className="back" disabled={step === 0} onClick={() => setStep(s => s - 1)}><ChevronLeft/> 이전</button>
        {step < 2 && <button className="next" onClick={next}>{step === 0 ? '사진 고르기' : '사진 완성하기'} <ChevronRight/></button>}
      </footer>
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
}
function drawCover(ctx, img, x, y, w, h) {
  const iw = img.videoWidth || img.naturalWidth || img.width;
  const ih = img.videoHeight || img.naturalHeight || img.height;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale, dh = ih * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}
function drawContain(ctx, img, x, y, w, h) {
  const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}
function getGuidePlacement(scalePercent, xPercent = 81, yPercent = 50) {
  const scale = Math.min(1.8, Math.max(.5, Number(scalePercent || 100) / 100));
  const width = GUIDE_PLACEMENT.width * scale;
  const height = GUIDE_PLACEMENT.height * scale;
  return {
    x: Math.max(0, Math.min(100, Number(xPercent))) / 100 - width / 2,
    y: Math.max(0, Math.min(100, Number(yPercent))) / 100 - height / 2,
    width,
    height
  };
}
function getGuideStyle(placement) {
  return {
    left: `${placement.x * 100}%`,
    top: `${placement.y * 100}%`,
    width: `${placement.width * 100}%`,
    height: `${placement.height * 100}%`
  };
}
function loadImage(src) {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src; });
}

function resizeImageFile(file, maxWidth, maxHeight, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = async event => {
      try {
        const img = await loadImage(event.target.result);
        const scale = Math.min(1, maxWidth / img.naturalWidth, maxHeight / img.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (error) { reject(error); }
    };
    reader.readAsDataURL(file);
  });
}

async function compressGuideGif(file, removeBackground, onProgress) {
  const buffer = await file.arrayBuffer();
  const gif = decode(buffer);
  const decodedBytes = gif.width * gif.height * gif.frames.length * 4;
  if (decodedBytes > MAX_DECODED_GIF_BYTES) {
    throw new Error('GIF의 해상도나 재생 시간이 너무 깁니다. 크기 또는 재생 시간을 줄인 뒤 다시 시도해 주세요.');
  }

  onProgress(`GIF 프레임 읽는 중… (${gif.frames.length}장)`);
  const decodedFrames = await decodeFrames(buffer, { gif, workerUrl: gifWorkerUrl });
  const attempts = [
    { maxSide: 520, maxFrames: 72, maxColors: 96 },
    { maxSide: 440, maxFrames: 56, maxColors: 72 },
    { maxSide: 360, maxFrames: 44, maxColors: 56 },
    { maxSide: 300, maxFrames: 32, maxColors: 40 },
    { maxSide: 240, maxFrames: 24, maxColors: 32 },
  ];
  let bestBlob = null;

  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    const scale = Math.min(1, attempt.maxSide / Math.max(gif.width, gif.height));
    const width = Math.max(1, Math.round(gif.width * scale));
    const height = Math.max(1, Math.round(gif.height * scale));
    const sampled = sampleGifFrames(decodedFrames, attempt.maxFrames);
    onProgress(`${removeBackground ? '흰 배경 제거·' : ''}GIF 압축 중… ${index + 1}/${attempts.length} · ${width}×${height}`);
    const frames = resizeGifFrames(sampled, width, height, removeBackground);
    const output = await encode({
      workerUrl: gifWorkerUrl,
      width,
      height,
      frames,
      maxColors: attempt.maxColors,
      premultipliedAlpha: true,
      dither: 'floyd-steinberg',
      ditherTransparency: 'floyd-steinberg',
    });
    const blob = new Blob([output], { type: 'image/gif' });
    if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;
    if (blob.size <= TARGET_GIF_BYTES) return { blob, width, height };
    await yieldToBrowser();
  }

  if (bestBlob.size > 1.8 * 1024 * 1024) {
    throw new Error('자동 압축 후에도 GIF가 너무 큽니다. 더 짧은 GIF로 다시 시도해 주세요.');
  }
  return { blob: bestBlob };
}

function sampleGifFrames(frames, maxFrames) {
  if (frames.length <= maxFrames) return frames;
  const sampled = [];
  const step = frames.length / maxFrames;
  for (let index = 0; index < maxFrames; index += 1) {
    const start = Math.floor(index * step);
    const end = Math.max(start + 1, Math.floor((index + 1) * step));
    const delay = frames.slice(start, end).reduce((sum, frame) => sum + Math.max(frame.delay || 20, 20), 0);
    sampled.push({ ...frames[start], delay });
  }
  return sampled;
}

function resizeGifFrames(frames, width, height, removeBackground) {
  const source = document.createElement('canvas');
  const target = document.createElement('canvas');
  const sourceCtx = source.getContext('2d');
  const targetCtx = target.getContext('2d', { willReadFrequently: true });
  target.width = width;
  target.height = height;
  targetCtx.imageSmoothingEnabled = true;
  targetCtx.imageSmoothingQuality = 'high';

  return frames.map(frame => {
    source.width = frame.width;
    source.height = frame.height;
    sourceCtx.putImageData(new ImageData(frame.data, frame.width, frame.height), 0, 0);
    targetCtx.clearRect(0, 0, width, height);
    targetCtx.drawImage(source, 0, 0, width, height);
    const pixels = targetCtx.getImageData(0, 0, width, height).data;
    return { data: removeBackground ? removeEdgeWhiteBackground(pixels, width, height) : pixels, delay: frame.delay };
  });
}

function removeEdgeWhiteBackground(pixels, width, height) {
  const result = new Uint8ClampedArray(pixels);
  const pixelCount = width * height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;

  const isEdgeWhite = index => {
    const offset = index * 4;
    const alpha = result[offset + 3];
    if (alpha < 24) return true;
    const red = result[offset];
    const green = result[offset + 1];
    const blue = result[offset + 2];
    return alpha > 220 && Math.min(red, green, blue) >= 238 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 18;
  };

  const corners = [0, width - 1, (height - 1) * width, pixelCount - 1];
  const whiteCornerCount = corners.filter(index => isEdgeWhite(index) && result[index * 4 + 3] > 220).length;
  const transparentCornerCount = corners.filter(index => result[index * 4 + 3] < 24).length;
  if (whiteCornerCount < 2 && transparentCornerCount < 2) return result;

  const enqueue = index => {
    if (visited[index] || !isEdgeWhite(index)) return;
    visited[index] = 1;
    queue[tail] = index;
    tail += 1;
  };

  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const index = queue[head];
    head += 1;
    result[index * 4 + 3] = 0;
    const x = index % width;
    if (x > 0) enqueue(index - 1);
    if (x < width - 1) enqueue(index + 1);
    if (index >= width) enqueue(index - width);
    if (index < pixelCount - width) enqueue(index + width);
  }

  // Feather one pixel around the removed area to avoid a pale halo.
  const sourceAlpha = new Uint8ClampedArray(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) sourceAlpha[index] = result[index * 4 + 3];
  for (let index = 0; index < pixelCount; index += 1) {
    if (sourceAlpha[index] === 0) continue;
    const x = index % width;
    const touchesTransparent = (x > 0 && sourceAlpha[index - 1] === 0)
      || (x < width - 1 && sourceAlpha[index + 1] === 0)
      || (index >= width && sourceAlpha[index - width] === 0)
      || (index < pixelCount - width && sourceAlpha[index + width] === 0);
    if (!touchesTransparent) continue;
    const offset = index * 4;
    const minimum = Math.min(result[offset], result[offset + 1], result[offset + 2]);
    const maximum = Math.max(result[offset], result[offset + 1], result[offset + 2]);
    if (minimum >= 215 && maximum - minimum <= 28) {
      result[offset + 3] = Math.min(result[offset + 3], Math.max(0, Math.min(255, (255 - minimum) * 12)));
    }
  }
  return result;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('압축된 GIF를 읽지 못했습니다.'));
    reader.readAsDataURL(blob);
  });
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function yieldToBrowser() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

createRoot(document.getElementById('root')).render(location.pathname.startsWith('/admin') ? <AdminPage /> : <App />);
