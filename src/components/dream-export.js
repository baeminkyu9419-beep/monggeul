// 몽글몽글 — 꿈 기록 관리 진입점
// QR 전송: dream-export-qr.js, PDF/이미지: dream-export-pdf.js

import { showToast } from './toast.js';
import { logEvent } from '../services/analytics.js';

// 서브모듈 로드 (window 함수 등록 사이드이펙트)
import './dream-export-pdf.js';
import { handleQRImport } from './dream-export-qr.js';
import './dream-export-qr.js';

// handleQRImport 재수출 (app.js가 동적 import로 사용)
export { handleQRImport };

export function showExportModal() {
  let modal = document.getElementById('exportModal');
  if (modal) { modal.style.display = 'block'; return; }

  modal = document.createElement('div');
  modal.id = 'exportModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(14,12,26,.95);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;animation:su .3s ease';

  const logs = JSON.parse(localStorage.getItem('mg_logs') || '[]');
  const count = logs.filter(l => !l.noDream).length;

  modal.innerHTML = `<div style="max-width:360px;width:100%;background:var(--card-bg);border:1px solid rgba(166,124,239,.15);border-radius:20px;padding:24px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <div style="font-size:16px;font-weight:900;color:var(--moon)">📦 꿈 기록 관리</div>
      <button onclick="closeExportModal()" style="background:none;border:none;font-size:18px;color:var(--text-muted);cursor:pointer">✕</button>
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:16px">${count}개의 꿈 기록</div>

    <div style="font-size:12px;font-weight:700;color:var(--text-secondary);margin-bottom:10px">내보내기</div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px">
      <button onclick="exportDreamsJSON()" style="display:flex;align-items:center;gap:10px;padding:12px;background:rgba(166,124,239,.06);border:1px solid rgba(166,124,239,.12);border-radius:14px;cursor:pointer;text-align:left;color:var(--text-primary)">
        <span style="font-size:20px">📋</span>
        <div><div style="font-size:12px;font-weight:700">JSON</div><div style="font-size:10px;color:var(--text-muted)">전체 데이터 (다시 가져올 수 있어요)</div></div>
      </button>
      <button onclick="exportDreamsCSV()" style="display:flex;align-items:center;gap:10px;padding:12px;background:rgba(125,232,216,.06);border:1px solid rgba(125,232,216,.12);border-radius:14px;cursor:pointer;text-align:left;color:var(--text-primary)">
        <span style="font-size:20px">📊</span>
        <div><div style="font-size:12px;font-weight:700">CSV (엑셀)</div><div style="font-size:10px;color:var(--text-muted)">스프레드시트에서 분석하기</div></div>
      </button>
      <button onclick="exportDreamsPDF()" style="display:flex;align-items:center;gap:10px;padding:12px;background:rgba(248,201,76,.06);border:1px solid rgba(248,201,76,.12);border-radius:14px;cursor:pointer;text-align:left;color:var(--text-primary)">
        <span style="font-size:20px">📄</span>
        <div><div style="font-size:12px;font-weight:700">PDF 리포트</div><div style="font-size:10px;color:var(--text-muted)">이쁘게 꾸민 꿈 일기장</div></div>
      </button>
      <button onclick="exportMonthlyReportPDF()" style="display:flex;align-items:center;gap:10px;padding:12px;background:rgba(166,124,239,.08);border:1px solid rgba(166,124,239,.18);border-radius:14px;cursor:pointer;text-align:left;color:var(--text-primary)">
        <span style="font-size:20px">🌙</span>
        <div><div style="font-size:12px;font-weight:700">월간 분석 리포트</div><div style="font-size:10px;color:var(--text-muted)">꿈 분석 + 차트 + 달이 코멘트 PDF</div></div>
      </button>
    </div>

    <div style="font-size:12px;font-weight:700;color:var(--text-secondary);margin-bottom:10px">가져오기</div>
    <button onclick="document.getElementById('importFileInput').click()" style="width:100%;display:flex;align-items:center;gap:10px;padding:12px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:14px;cursor:pointer;color:var(--text-primary)">
      <span style="font-size:20px">📥</span>
      <div><div style="font-size:12px;font-weight:700">JSON 파일로 가져오기</div><div style="font-size:10px;color:var(--text-muted)">이전에 내보낸 데이터를 복원해요</div></div>
    </button>
    <input type="file" id="importFileInput" accept=".json" style="display:none" onchange="importDreamsJSON(this)">

    <div style="font-size:12px;font-weight:700;color:var(--text-secondary);margin:16px 0 10px">디바이스 간 전송</div>
    <div style="display:flex;gap:8px">
      <button onclick="showQRSend()" style="flex:1;display:flex;align-items:center;gap:10px;padding:12px;background:rgba(166,124,239,.06);border:1px solid rgba(166,124,239,.12);border-radius:14px;cursor:pointer;text-align:left;color:var(--text-primary)">
        <span style="font-size:20px">📲</span>
        <div><div style="font-size:12px;font-weight:700">QR 보내기</div><div style="font-size:10px;color:var(--text-muted)">이 기기의 꿈 데이터</div></div>
      </button>
      <button onclick="showQRReceive()" style="flex:1;display:flex;align-items:center;gap:10px;padding:12px;background:rgba(125,232,216,.06);border:1px solid rgba(125,232,216,.12);border-radius:14px;cursor:pointer;text-align:left;color:var(--text-primary)">
        <span style="font-size:20px">📷</span>
        <div><div style="font-size:12px;font-weight:700">QR 받기</div><div style="font-size:10px;color:var(--text-muted)">다른 기기에서 스캔</div></div>
      </button>
    </div>
  </div>`;

  document.body.appendChild(modal);
  logEvent('export_modal_opened');
}

window.closeExportModal = function() {
  const m = document.getElementById('exportModal');
  if (m) m.style.display = 'none';
};

// ── JSON 내보내기 ──
window.exportDreamsJSON = function() {
  const logs = JSON.parse(localStorage.getItem('mg_logs') || '[]');
  const data = {
    app: 'monggeul',
    version: '2.0',
    exportedAt: new Date().toISOString(),
    dreamCount: logs.filter(l => !l.noDream).length,
    dreams: logs,
    sleepLogs: JSON.parse(localStorage.getItem('mg_sleep_logs') || '[]'),
    xp: parseInt(localStorage.getItem('mg_xp') || '0'),
    streak: parseInt(localStorage.getItem('mg_streak') || '0'),
    nickname: localStorage.getItem('mg_nickname') || ''
  };
  downloadFile(JSON.stringify(data, null, 2), 'monggeul-dreams.json', 'application/json');
  logEvent('dreams_exported', { format: 'json', count: data.dreamCount });
  showToast('JSON으로 내보냈어요! 📋');
};

// ── CSV 내보내기 ──
window.exportDreamsCSV = function() {
  const logs = JSON.parse(localStorage.getItem('mg_logs') || '[]').filter(l => !l.noDream);
  const headers = ['날짜', '제목', '내용', '배지', '감정', '길흉', '연애운', '재물운', '건강운', '활력', '직관', '후기'];
  const rows = logs.map(l => {
    const s = l.stats || {};
    return [
      csvEsc(l.date || ''),
      csvEsc(l.title || ''),
      csvEsc((l.text || '').replace(/\n/g, ' ')),
      csvEsc((l.badges || []).join(', ')),
      csvEsc((l.emotions || []).join(', ')),
      s['길흉'] || '', s['연애운'] || '', s['재물운'] || '', s['건강운'] || '', s['활력'] || '', s['직관'] || '',
      csvEsc(l.review || '')
    ].join(',');
  });
  const bom = '﻿';
  downloadFile(bom + headers.join(',') + '\n' + rows.join('\n'), 'monggeul-dreams.csv', 'text/csv');
  logEvent('dreams_exported', { format: 'csv', count: logs.length });
  showToast('CSV로 내보냈어요! 📊');
};

// ── JSON 가져오기 ──
window.importDreamsJSON = function(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      if (data.app !== 'monggeul') { showToast('몽글몽글 데이터가 아니에요'); return; }
      const existing = JSON.parse(localStorage.getItem('mg_logs') || '[]');
      const existingIds = new Set(existing.map(l => l.id).filter(Boolean));
      const newDreams = (data.dreams || []).filter(d => !existingIds.has(d.id));
      if (newDreams.length === 0) { showToast('새로 가져올 꿈이 없어요 (이미 모두 있음)'); return; }
      const merged = [...newDreams, ...existing];
      localStorage.setItem('mg_logs', JSON.stringify(merged));
      if (data.sleepLogs) {
        const existingSleep = JSON.parse(localStorage.getItem('mg_sleep_logs') || '[]');
        const sleepDates = new Set(existingSleep.map(s => s.date));
        const newSleep = data.sleepLogs.filter(s => !sleepDates.has(s.date));
        localStorage.setItem('mg_sleep_logs', JSON.stringify([...newSleep, ...existingSleep]));
      }
      showToast(newDreams.length + '개 꿈을 가져왔어요! 📥');
      logEvent('dreams_imported', { count: newDreams.length });
      closeExportModal();
      if (window.renderLog) window.renderLog();
      if (window.updateStats) window.updateStats();
    } catch (err) {
      showToast('파일을 읽을 수 없어요. JSON 형식인지 확인하세요.');
    }
  };
  reader.readAsText(file);
};

function csvEsc(s) {
  if (typeof s !== 'string') return String(s);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  downloadBlob(blob, filename);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

window.showExportModal = showExportModal;
