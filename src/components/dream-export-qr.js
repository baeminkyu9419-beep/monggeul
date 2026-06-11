// 몽글몽글 — QR 코드 디바이스 간 전송 (dream-export.js에서 분리)
import { showToast } from './toast.js';
import { logEvent } from '../services/analytics.js';
import QRCode from 'qrcode';
import { Html5Qrcode } from 'html5-qrcode';

const APP_BASE = 'https://baeminkyu9419-beep.github.io/monggeul/';
const QR_MAX_BYTES = 2200; // QR 안전 용량 (Version 25 Binary)

function compressDreams(logs) {
  return logs.map(l => ({
    id: l.id, d: l.date, t: l.title, x: (l.text || '').substring(0, 120),
    b: l.badges, e: l.emotions, s: l.stats
  }));
}

function decompressDreams(arr) {
  return arr.map(c => ({
    id: c.id, date: c.d, title: c.t, text: c.x,
    badges: c.b, emotions: c.e, stats: c.s
  }));
}

function buildQRPayload(logs) {
  const compressed = compressDreams(logs);
  const json = JSON.stringify({ a: 'mg', v: 2, n: localStorage.getItem('mg_nickname') || '', d: compressed });
  return btoa(unescape(encodeURIComponent(json)));
}

function parseQRPayload(b64) {
  const json = decodeURIComponent(escape(atob(b64)));
  const data = JSON.parse(json);
  if (data.a !== 'mg') throw new Error('Invalid app data');
  return { nickname: data.n, dreams: decompressDreams(data.d) };
}

window.showQRSend = async function() {
  const logs = JSON.parse(localStorage.getItem('mg_logs') || '[]').filter(l => !l.noDream);
  if (logs.length === 0) { showToast('전송할 꿈이 없어요'); return; }

  let target = logs;
  let payload = buildQRPayload(target);
  while (payload.length > QR_MAX_BYTES && target.length > 1) {
    target = target.slice(0, Math.max(1, Math.floor(target.length * 0.7)));
    payload = buildQRPayload(target);
  }

  if (payload.length > QR_MAX_BYTES) {
    showToast('데이터가 너무 커서 QR 전송이 어려워요. JSON 내보내기를 이용하세요.');
    return;
  }

  const url = APP_BASE + '#qr-import=' + payload;
  const trimmed = target.length < logs.length;

  const modal = document.createElement('div');
  modal.id = 'qrSendModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(14,12,26,.97);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;animation:su .3s ease';
  modal.innerHTML = `<div style="max-width:340px;width:100%;background:var(--card-bg);border:1px solid rgba(166,124,239,.15);border-radius:20px;padding:24px;text-align:center">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div style="font-size:15px;font-weight:900;color:var(--moon)">📲 QR 코드로 보내기</div>
      <button onclick="document.getElementById('qrSendModal').remove()" style="background:none;border:none;font-size:18px;color:var(--text-muted);cursor:pointer">✕</button>
    </div>
    <div id="qrCanvas" style="background:#fff;border-radius:12px;padding:12px;display:inline-block;margin-bottom:12px"></div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">
      ${target.length}개의 꿈 ${trimmed ? '(최근 ' + target.length + '/' + logs.length + '개)' : ''} 포함
    </div>
    ${trimmed ? '<div style="font-size:10px;color:#f8c94c;margin-bottom:8px">데이터가 커서 최근 꿈만 포함됐어요. 전체 전송은 JSON 내보내기를 이용하세요.</div>' : ''}
    <div style="font-size:11px;color:var(--text-muted)">다른 기기에서 몽글몽글 앱을 열고<br>📷 <b>QR 받기</b>로 스캔하세요</div>
  </div>`;
  document.body.appendChild(modal);
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

  try {
    const canvas = await QRCode.toCanvas(url, {
      width: 240, margin: 2,
      color: { dark: '#1a1535', light: '#ffffff' }
    });
    document.getElementById('qrCanvas').appendChild(canvas);
    logEvent('qr_send_generated', { count: target.length, trimmed });
  } catch (e) {
    document.getElementById('qrCanvas').innerHTML = '<div style="color:#e74c3c;font-size:12px;padding:20px">QR 생성 실패</div>';
  }
};

window.showQRReceive = async function() {
  const modal = document.createElement('div');
  modal.id = 'qrReceiveModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(14,12,26,.97);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;animation:su .3s ease';
  modal.innerHTML = `<div style="max-width:340px;width:100%;background:var(--card-bg);border:1px solid rgba(125,232,216,.15);border-radius:20px;padding:24px;text-align:center">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div style="font-size:15px;font-weight:900;color:var(--moon)">📷 QR 코드 스캔</div>
      <button id="qrReceiveClose" style="background:none;border:none;font-size:18px;color:var(--text-muted);cursor:pointer">✕</button>
    </div>
    <div id="qrReader" style="width:100%;border-radius:12px;overflow:hidden;margin-bottom:12px"></div>
    <div style="font-size:11px;color:var(--text-muted)">보내는 기기의 QR 코드를 카메라로 스캔하세요</div>
  </div>`;
  document.body.appendChild(modal);

  let scanner = null;
  const cleanup = () => {
    if (scanner) { scanner.stop().catch(() => {}); scanner.clear(); scanner = null; }
    modal.remove();
  };
  document.getElementById('qrReceiveClose').onclick = cleanup;
  modal.onclick = (e) => { if (e.target === modal) cleanup(); };

  try {
    scanner = new Html5Qrcode('qrReader');
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 220, height: 220 } },
      (decodedText) => {
        cleanup();
        handleQRImport(decodedText);
      },
      () => {}
    );
  } catch (e) {
    document.getElementById('qrReader').innerHTML = `<div style="padding:24px;font-size:12px;color:#f8c94c">카메라 접근이 불가해요. 브라우저 설정에서 카메라를 허용해주세요.</div>`;
  }
};

export function handleQRImport(url) {
  try {
    const hashIdx = url.indexOf('#qr-import=');
    if (hashIdx === -1) { showToast('몽글몽글 QR이 아니에요'); return; }
    const b64 = url.substring(hashIdx + 11);
    const { nickname, dreams } = parseQRPayload(b64);

    const existing = JSON.parse(localStorage.getItem('mg_logs') || '[]');
    const existingIds = new Set(existing.map(l => l.id).filter(Boolean));
    const newDreams = dreams.filter(d => d.id && !existingIds.has(d.id));

    if (newDreams.length === 0) {
      showToast('새로 가져올 꿈이 없어요 (이미 모두 있음)');
      return;
    }

    const merged = [...newDreams, ...existing];
    localStorage.setItem('mg_logs', JSON.stringify(merged));
    showToast(newDreams.length + '개 꿈을 QR로 가져왔어요! 📲');
    logEvent('qr_receive_imported', { count: newDreams.length, from: nickname });

    if (window.renderLog) window.renderLog();
    if (window.updateStats) window.updateStats();
  } catch (e) {
    showToast('QR 데이터를 읽을 수 없어요');
  }
}
