// 몽글몽글 — 꿈 기록 내보내기 (Phase 3-5)
// JSON / CSV / PDF 형식 선택 + 가져오기 + 월간 PDF 리포트

import { showToast } from './toast.js';
import { logEvent } from '../services/analytics.js';
import { generatePatternReport } from '../services/dream-pattern.js';
import QRCode from 'qrcode';
import { Html5Qrcode } from 'html5-qrcode';

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
  const bom = '\uFEFF'; // UTF-8 BOM for Excel
  downloadFile(bom + headers.join(',') + '\n' + rows.join('\n'), 'monggeul-dreams.csv', 'text/csv');
  logEvent('dreams_exported', { format: 'csv', count: logs.length });
  showToast('CSV로 내보냈어요! 📊');
};

// ── PDF 내보내기 (캔버스 → 이미지) ──
window.exportDreamsPDF = async function() {
  const logs = JSON.parse(localStorage.getItem('mg_logs') || '[]').filter(l => !l.noDream);
  if (logs.length === 0) { showToast('내보낼 꿈이 없어요'); return; }

  showToast('PDF 생성 중...');
  const nick = localStorage.getItem('mg_nickname') || '꿈탐험가';
  const c = document.createElement('canvas');
  const W = 800, pageH = 1100;
  const dreams = logs.slice(0, 20); // 최대 20개
  const pagesNeeded = Math.ceil(dreams.length / 4);
  c.width = W;
  c.height = pageH * pagesNeeded;
  const ctx = c.getContext('2d');

  // 전체 배경
  for (let p = 0; p < pagesNeeded; p++) {
    const yOff = p * pageH;
    const bg = ctx.createLinearGradient(0, yOff, 0, yOff + pageH);
    bg.addColorStop(0, '#0e0c1a'); bg.addColorStop(0.5, '#1a1535'); bg.addColorStop(1, '#0e0c1a');
    ctx.fillStyle = bg; ctx.fillRect(0, yOff, W, pageH);
  }

  // 표지
  ctx.fillStyle = '#f5e6b2'; ctx.font = 'bold 36px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('🌙 ' + nick + '의 꿈 일기장', W / 2, 80);
  ctx.fillStyle = '#a89dd0'; ctx.font = '16px sans-serif';
  ctx.fillText(dreams.length + '개의 꿈 · ' + new Date().toLocaleDateString('ko-KR'), W / 2, 120);

  // 꿈 항목
  let y = 170;
  dreams.forEach((l, i) => {
    if (y > c.height - 100) return;
    // 배경 카드
    ctx.fillStyle = 'rgba(255,255,255,.03)';
    ctx.beginPath(); ctx.roundRect(40, y, W - 80, 200, 12); ctx.fill();
    ctx.strokeStyle = 'rgba(166,124,239,.15)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(40, y, W - 80, 200, 12); ctx.stroke();

    // 날짜 + 제목
    ctx.textAlign = 'left';
    ctx.fillStyle = '#6b5e8a'; ctx.font = '12px sans-serif';
    ctx.fillText(l.date || '', 60, y + 24);
    ctx.fillStyle = '#f0ecff'; ctx.font = 'bold 16px sans-serif';
    ctx.fillText((l.title || '꿈').substring(0, 40), 60, y + 48);

    // 배지
    if (l.badges && l.badges.length) {
      ctx.fillStyle = '#a67cef'; ctx.font = '11px sans-serif';
      ctx.fillText(l.badges.join(' · '), 60, y + 68);
    }

    // 본문 (3줄 제한)
    ctx.fillStyle = '#a89dd0'; ctx.font = '13px sans-serif';
    const text = (l.text || '').substring(0, 200);
    const words = text.split('');
    let line = '', lineY = y + 92;
    for (let j = 0; j < words.length && lineY < y + 170; j++) {
      line += words[j];
      if (ctx.measureText(line).width > W - 140 || words[j] === '\n') {
        ctx.fillText(line.replace('\n', ''), 60, lineY);
        lineY += 20; line = '';
      }
    }
    if (line) ctx.fillText(line, 60, lineY);

    // 후기
    if (l.review) {
      ctx.fillStyle = '#7de8d8'; ctx.font = '11px sans-serif';
      ctx.fillText('후기: ' + l.review, 60, y + 185);
    }

    y += 220;
  });

  // 푸터
  ctx.fillStyle = 'rgba(200,191,248,.3)'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('몽글몽글 · 꿈을 기록하고 나를 이해하는 시간', W / 2, y + 30);

  try {
    const blob = await new Promise(resolve => c.toBlob(resolve, 'image/png'));
    downloadBlob(blob, 'monggeul-dream-diary.png');
    logEvent('dreams_exported', { format: 'pdf', count: dreams.length });
    showToast('꿈 일기장 이미지가 다운로드됐어요! 📄');
  } catch (e) {
    showToast('PDF 생성에 실패했어요');
  }
};

// ── 월간 분석 리포트 PDF ──
const EMOTION_STATES = ['평온', '불안', '공포', '기쁨', '슬픔'];
const EMOTION_COLORS = { 평온: [125,232,216], 불안: [248,201,76], 공포: [240,168,200], 기쁨: [166,124,239], 슬픔: [144,176,255] };
const EMOTION_EMOJI = { 평온: '😌', 불안: '😰', 공포: '😱', 기쁨: '😊', 슬픔: '😢' };

function classifyEmotion(log) {
  const badges = log.badges || [];
  const emotion = log.emotion || '';
  const text = log.text || '';
  if (badges.includes('흉몽') || /무서|공포|귀신|쫓기/.test(text)) return '공포';
  if (/불안|초조|긴장|스트레스/.test(emotion) || /이빨|추락|시험|지각/.test(text)) return '불안';
  if (/슬픔|그리움|외로|이별/.test(emotion) || /울|이별|죽|헤어/.test(text)) return '슬픔';
  if (badges.includes('길몽') || /기쁨|행복|설렘|해방/.test(emotion)) return '기쁨';
  return '평온';
}

function generateDaliComment(report, monthLogs) {
  const { emotionDist, clusters, prediction, totalDreams } = report;
  const lines = [];

  // 감정 분포 기반 코멘트
  const dominant = EMOTION_STATES.reduce((a, b) => emotionDist[a] >= emotionDist[b] ? a : b);
  const dominantPct = totalDreams > 0 ? Math.round(emotionDist[dominant] / totalDreams * 100) : 0;

  const emotionMessages = {
    평온: '이번 달은 전반적으로 평온한 꿈이 많았어요. 마음이 안정된 시기를 보내고 있는 것 같아요.',
    불안: '불안한 꿈이 좀 있었네요. 혹시 요즘 걱정되는 일이 있나요? 괜찮아요, 꿈은 마음의 정리 과정이에요.',
    공포: '무서운 꿈이 좀 있었지만, 이런 꿈은 오히려 마음속 두려움을 안전하게 처리하는 과정일 수 있어요.',
    기쁨: '기쁜 꿈이 많은 달이었어요! 긍정적인 에너지가 꿈에서도 느껴져요.',
    슬픔: '슬픈 꿈이 있었네요. 마음속에 정리하고 싶은 감정이 있을 수 있어요. 천천히 돌아봐도 좋아요.'
  };
  lines.push(emotionMessages[dominant]);

  // 반복꿈 코멘트
  if (clusters && clusters.length > 0) {
    const top = clusters[0];
    lines.push(`"${top.keyword}" 관련 꿈이 ${top.count}번이나 나타났어요. 이 주제가 요즘 마음속에 자리잡고 있는 것 같아요.`);
  }

  // 예측 코멘트
  if (prediction && prediction.predicted) {
    const predMsg = {
      평온: '다음 꿈은 평온할 가능성이 높아요. 편안한 밤 되세요.',
      불안: '다음 꿈에서 불안 요소가 나타날 수 있어요. 자기 전 따뜻한 차 한 잔 어때요?',
      공포: '패턴상 긴장되는 꿈이 올 수 있지만, 달이가 응원하고 있어요!',
      기쁨: '좋은 꿈을 꿀 확률이 높아요. 기대해도 좋을 것 같아요!',
      슬픔: '감성적인 꿈이 올 수 있어요. 그것도 자기 이해의 한 부분이에요.'
    };
    lines.push(predMsg[prediction.predicted]);
  }

  // 꿈 빈도 코멘트
  if (totalDreams >= 20) {
    lines.push('이번 달 꿈 기록이 정말 풍부해요! 꾸준한 기록이 자기 이해의 첫걸음이에요.');
  } else if (totalDreams >= 10) {
    lines.push('꾸준히 기록하고 있네요. 이 습관이 쌓이면 무의식의 패턴이 더 선명해질 거예요.');
  } else if (totalDreams >= 3) {
    lines.push('기록을 시작한 것만으로도 대단해요. 조금씩 더 기록해보면 재미있는 패턴을 발견할 수 있을 거예요.');
  }

  return lines.join('\n\n');
}

window.exportMonthlyReportPDF = async function() {
  const allLogs = JSON.parse(localStorage.getItem('mg_logs') || '[]').filter(l => !l.noDream);
  if (allLogs.length < 3) { showToast('월간 리포트를 만들려면 꿈 3개 이상 필요해요'); return; }

  showToast('월간 리포트 생성 중... 🌙');

  // 이번 달 꿈 필터링
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthStr = `${year}. ${month + 1}.`;
  const monthLogs = allLogs.filter(l => {
    const d = l.date || '';
    return d.startsWith(monthStr) || d.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`);
  });

  // 데이터가 부족하면 전체 로그 사용
  const targetLogs = monthLogs.length >= 3 ? monthLogs : allLogs;
  const isFullData = targetLogs === allLogs;
  const periodLabel = isFullData ? '전체 기간' : `${year}년 ${month + 1}월`;

  const report = generatePatternReport(targetLogs);
  if (!report) { showToast('분석할 데이터가 부족해요'); return; }

  const nick = localStorage.getItem('mg_nickname') || '꿈탐험가';
  const daliComment = generateDaliComment(report, targetLogs);

  try {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210, H = 297;
    const margin = 20;
    const contentW = W - margin * 2;

    // ── 페이지 배경 헬퍼 ──
    function drawPageBg() {
      doc.setFillColor(14, 12, 26);
      doc.rect(0, 0, W, H, 'F');
      // 상단 그라데이션 장식
      doc.setFillColor(26, 21, 53);
      doc.rect(0, 0, W, 60, 'F');
      doc.setFillColor(20, 17, 40);
      doc.rect(0, 60, W, 20, 'F');
    }

    // ── 페이지 1: 표지 + 요약 ──
    drawPageBg();

    // 타이틀
    doc.setTextColor(245, 230, 178);
    doc.setFontSize(24);
    doc.text(`${nick}님의 꿈 리포트`, W / 2, 35, { align: 'center' });

    doc.setTextColor(168, 157, 208);
    doc.setFontSize(12);
    doc.text(periodLabel, W / 2, 45, { align: 'center' });
    doc.text(new Date().toLocaleDateString('ko-KR') + ' 생성', W / 2, 52, { align: 'center' });

    // 요약 카드
    let y = 70;
    doc.setFillColor(255, 255, 255, 0.03);
    doc.roundedRect(margin, y, contentW, 35, 3, 3, 'F');
    doc.setDrawColor(166, 124, 239);
    doc.setLineWidth(0.3);
    doc.roundedRect(margin, y, contentW, 35, 3, 3, 'S');

    doc.setTextColor(166, 124, 239);
    doc.setFontSize(10);
    doc.text('SUMMARY', margin + 5, y + 8);

    doc.setTextColor(240, 236, 255);
    doc.setFontSize(14);
    const summaryItems = [
      [`${report.totalDreams}`, 'dreams'],
      [`${EMOTION_STATES.reduce((a, b) => report.emotionDist[a] >= report.emotionDist[b] ? a : b)}`, 'dominant'],
      [`${report.clusters.length}`, 'patterns']
    ];
    const colW = contentW / 3;
    summaryItems.forEach((item, i) => {
      const cx = margin + colW * i + colW / 2;
      doc.setFontSize(20);
      doc.setTextColor(245, 230, 178);
      doc.text(item[0], cx, y + 22, { align: 'center' });
      doc.setFontSize(8);
      doc.setTextColor(168, 157, 208);
      const labels = { dreams: 'total dreams', dominant: 'dominant emotion', patterns: 'recurring' };
      doc.text(labels[item[1]], cx, y + 28, { align: 'center' });
    });

    // ── 감정 분포 차트 ──
    y = 115;
    doc.setTextColor(166, 124, 239);
    doc.setFontSize(11);
    doc.text('Emotion Distribution', margin, y);
    y += 8;

    const maxEmotion = Math.max(...Object.values(report.emotionDist), 1);
    EMOTION_STATES.forEach((state, i) => {
      const count = report.emotionDist[state];
      const pct = report.totalDreams > 0 ? Math.round(count / report.totalDreams * 100) : 0;
      const barW = (count / maxEmotion) * (contentW - 50);
      const barY = y + i * 12;
      const [r, g, b] = EMOTION_COLORS[state];

      // 라벨
      doc.setFontSize(9);
      doc.setTextColor(200, 191, 248);
      doc.text(`${EMOTION_EMOJI[state]} ${state}`, margin, barY + 4);

      // 바
      doc.setFillColor(r, g, b);
      doc.roundedRect(margin + 30, barY - 1, Math.max(barW, 2), 6, 2, 2, 'F');

      // 수치
      doc.setTextColor(168, 157, 208);
      doc.setFontSize(8);
      doc.text(`${count} (${pct}%)`, margin + 33 + Math.max(barW, 2), barY + 3);
    });

    // ── 반복꿈 패턴 ──
    y += 75;
    doc.setTextColor(166, 124, 239);
    doc.setFontSize(11);
    doc.text('Recurring Patterns', margin, y);
    y += 8;

    if (report.clusters.length === 0) {
      doc.setTextColor(168, 157, 208);
      doc.setFontSize(9);
      doc.text('- not enough recurring pattern data -', margin, y);
      y += 8;
    } else {
      report.clusters.slice(0, 5).forEach((c, i) => {
        doc.setFillColor(30, 25, 50);
        doc.roundedRect(margin, y - 2, contentW, 12, 2, 2, 'F');

        doc.setFontSize(9);
        doc.setTextColor(245, 230, 178);
        doc.text(`${c.keyword}`, margin + 4, y + 5);

        doc.setTextColor(168, 157, 208);
        doc.setFontSize(8);
        doc.text(`${c.count}x | avg ${c.avgInterval}day interval | ~${c.daysUntil}d until next`, margin + 50, y + 5);

        // 강도 바
        const intBarW = c.intensity / 100 * 30;
        doc.setFillColor(166, 124, 239);
        doc.roundedRect(contentW + margin - 35, y, intBarW, 6, 1, 1, 'F');

        y += 14;
      });
    }

    // ── 감정 예측 ──
    y += 5;
    if (report.prediction) {
      doc.setTextColor(166, 124, 239);
      doc.setFontSize(11);
      doc.text('Next Dream Prediction', margin, y);
      y += 8;

      doc.setFillColor(30, 25, 50);
      doc.roundedRect(margin, y - 2, contentW, 16, 2, 2, 'F');

      doc.setFontSize(9);
      doc.setTextColor(125, 232, 216);
      doc.text(`${EMOTION_EMOJI[report.prediction.current]} ${report.prediction.current}`, margin + 5, y + 5);
      doc.setTextColor(168, 157, 208);
      doc.text('->', margin + 40, y + 5);
      doc.setTextColor(245, 230, 178);
      doc.text(`${EMOTION_EMOJI[report.prediction.predicted]} ${report.prediction.predicted} (${report.prediction.probability}%)`, margin + 48, y + 5);

      y += 20;
    }

    // ── 페이지 2: 달이 코멘트 + 꿈 하이라이트 ──
    doc.addPage();
    drawPageBg();

    y = 30;
    doc.setTextColor(166, 124, 239);
    doc.setFontSize(13);
    doc.text('Dali Comment', margin, y);
    y += 4;

    doc.setFillColor(26, 21, 53);
    doc.roundedRect(margin, y, contentW, 60, 3, 3, 'F');
    doc.setDrawColor(125, 232, 216);
    doc.setLineWidth(0.3);
    doc.roundedRect(margin, y, contentW, 60, 3, 3, 'S');

    doc.setTextColor(200, 191, 248);
    doc.setFontSize(9);
    const daliLines = doc.splitTextToSize(daliComment, contentW - 10);
    doc.text(daliLines, margin + 5, y + 10);

    // ── 꿈 하이라이트 (최대 8개) ──
    y += 70;
    doc.setTextColor(166, 124, 239);
    doc.setFontSize(11);
    doc.text(`Dream Highlights (${periodLabel})`, margin, y);
    y += 8;

    const highlights = targetLogs.slice(0, 8);
    highlights.forEach((l, i) => {
      if (y > H - 30) {
        doc.addPage();
        drawPageBg();
        y = 30;
      }

      const cardH = 22;
      doc.setFillColor(30, 25, 50);
      doc.roundedRect(margin, y - 2, contentW, cardH, 2, 2, 'F');

      // 날짜
      doc.setFontSize(7);
      doc.setTextColor(107, 94, 138);
      doc.text(l.date || '', margin + 3, y + 4);

      // 제목
      doc.setFontSize(9);
      doc.setTextColor(240, 236, 255);
      doc.text((l.title || 'dream').substring(0, 50), margin + 3, y + 11);

      // 배지
      if (l.badges && l.badges.length) {
        doc.setFontSize(7);
        doc.setTextColor(166, 124, 239);
        doc.text(l.badges.join(' / '), margin + 3, y + 17);
      }

      // 감정
      const emo = classifyEmotion(l);
      doc.setFontSize(8);
      const [r, g, b] = EMOTION_COLORS[emo];
      doc.setTextColor(r, g, b);
      doc.text(`${EMOTION_EMOJI[emo]} ${emo}`, contentW + margin - 25, y + 11);

      y += cardH + 3;
    });

    // ── 푸터 ──
    if (y > H - 25) { doc.addPage(); drawPageBg(); y = 30; }
    doc.setTextColor(168, 157, 208);
    doc.setFontSize(8);
    doc.text('Generated by MONGGEUL - Your Dream Companion', W / 2, H - 15, { align: 'center' });

    // 저장
    doc.save(`monggeul-monthly-report-${year}-${String(month + 1).padStart(2, '0')}.pdf`);
    logEvent('dreams_exported', { format: 'monthly_pdf', count: targetLogs.length, period: periodLabel });
    showToast('월간 리포트 PDF가 다운로드됐어요! 🌙');
  } catch (e) {
    console.error('PDF generation failed:', e);
    showToast('PDF 생성에 실패했어요. 다시 시도해주세요.');
  }
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

// ── QR 코드 디바이스 간 전송 ──
const APP_BASE = 'https://baeminkyu9419-beep.github.io/monggeul/';
const QR_MAX_BYTES = 2200; // QR 안전 용량 (Version 25 Binary)

function compressDreams(logs) {
  // 필수 필드만 추출하여 크기 최소화
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

  // 용량 체크 — 초과 시 최근 N개만
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

  // 모달 생성
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

  // QR 코드 생성
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
        // QR 읽기 성공
        cleanup();
        handleQRImport(decodedText);
      },
      () => {} // ignore scan errors
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

    // UI 갱신
    if (window.renderLog) window.renderLog();
    if (window.updateStats) window.updateStats();
  } catch (e) {
    showToast('QR 데이터를 읽을 수 없어요');
  }
}

window.showExportModal = showExportModal;
