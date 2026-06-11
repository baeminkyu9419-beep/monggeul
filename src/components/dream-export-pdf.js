// 몽글몽글 — PDF/이미지 내보내기 (dream-export.js에서 분리)
import { showToast } from './toast.js';
import { logEvent } from '../services/analytics.js';
import { generatePatternReport } from '../services/dream-pattern.js';

// ── PDF 내보내기 (캔버스 → 이미지) ──
window.exportDreamsPDF = async function() {
  const logs = JSON.parse(localStorage.getItem('mg_logs') || '[]').filter(l => !l.noDream);
  if (logs.length === 0) { showToast('내보낼 꿈이 없어요'); return; }

  showToast('PDF 생성 중...');
  const nick = localStorage.getItem('mg_nickname') || '꿈탐험가';
  const c = document.createElement('canvas');
  const W = 800, pageH = 1100;
  const dreams = logs.slice(0, 20);
  const pagesNeeded = Math.ceil(dreams.length / 4);
  c.width = W;
  c.height = pageH * pagesNeeded;
  const ctx = c.getContext('2d');

  for (let p = 0; p < pagesNeeded; p++) {
    const yOff = p * pageH;
    const bg = ctx.createLinearGradient(0, yOff, 0, yOff + pageH);
    bg.addColorStop(0, '#0e0c1a'); bg.addColorStop(0.5, '#1a1535'); bg.addColorStop(1, '#0e0c1a');
    ctx.fillStyle = bg; ctx.fillRect(0, yOff, W, pageH);
  }

  ctx.fillStyle = '#f5e6b2'; ctx.font = 'bold 36px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('🌙 ' + nick + '의 꿈 일기장', W / 2, 80);
  ctx.fillStyle = '#a89dd0'; ctx.font = '16px sans-serif';
  ctx.fillText(dreams.length + '개의 꿈 · ' + new Date().toLocaleDateString('ko-KR'), W / 2, 120);

  let y = 170;
  dreams.forEach((l, i) => {
    if (y > c.height - 100) return;
    ctx.fillStyle = 'rgba(255,255,255,.03)';
    ctx.beginPath(); ctx.roundRect(40, y, W - 80, 200, 12); ctx.fill();
    ctx.strokeStyle = 'rgba(166,124,239,.15)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(40, y, W - 80, 200, 12); ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#6b5e8a'; ctx.font = '12px sans-serif';
    ctx.fillText(l.date || '', 60, y + 24);
    ctx.fillStyle = '#f0ecff'; ctx.font = 'bold 16px sans-serif';
    ctx.fillText((l.title || '꿈').substring(0, 40), 60, y + 48);

    if (l.badges && l.badges.length) {
      ctx.fillStyle = '#a67cef'; ctx.font = '11px sans-serif';
      ctx.fillText(l.badges.join(' · '), 60, y + 68);
    }

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

    if (l.review) {
      ctx.fillStyle = '#7de8d8'; ctx.font = '11px sans-serif';
      ctx.fillText('후기: ' + l.review, 60, y + 185);
    }

    y += 220;
  });

  ctx.fillStyle = 'rgba(200,191,248,.3)'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('몽글몽글 · 꿈을 기록하고 나를 이해하는 시간', W / 2, y + 30);

  try {
    const blob = await new Promise(resolve => c.toBlob(resolve, 'image/png'));
    _downloadBlob(blob, 'monggeul-dream-diary.png');
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

  const dominant = EMOTION_STATES.reduce((a, b) => emotionDist[a] >= emotionDist[b] ? a : b);

  const emotionMessages = {
    평온: '이번 달은 전반적으로 평온한 꿈이 많았어요. 마음이 안정된 시기를 보내고 있는 것 같아요.',
    불안: '불안한 꿈이 좀 있었네요. 혹시 요즘 걱정되는 일이 있나요? 괜찮아요, 꿈은 마음의 정리 과정이에요.',
    공포: '무서운 꿈이 좀 있었지만, 이런 꿈은 오히려 마음속 두려움을 안전하게 처리하는 과정일 수 있어요.',
    기쁨: '기쁜 꿈이 많은 달이었어요! 긍정적인 에너지가 꿈에서도 느껴져요.',
    슬픔: '슬픈 꿈이 있었네요. 마음속에 정리하고 싶은 감정이 있을 수 있어요. 천천히 돌아봐도 좋아요.'
  };
  lines.push(emotionMessages[dominant]);

  if (clusters && clusters.length > 0) {
    const top = clusters[0];
    lines.push(`"${top.keyword}" 관련 꿈이 ${top.count}번이나 나타났어요. 이 주제가 요즘 마음속에 자리잡고 있는 것 같아요.`);
  }

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

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const monthStr = `${year}. ${month + 1}.`;
  const monthLogs = allLogs.filter(l => {
    const d = l.date || '';
    return d.startsWith(monthStr) || d.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`);
  });

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

    function drawPageBg() {
      doc.setFillColor(14, 12, 26);
      doc.rect(0, 0, W, H, 'F');
      doc.setFillColor(26, 21, 53);
      doc.rect(0, 0, W, 60, 'F');
      doc.setFillColor(20, 17, 40);
      doc.rect(0, 60, W, 20, 'F');
    }

    drawPageBg();

    doc.setTextColor(245, 230, 178);
    doc.setFontSize(24);
    doc.text(`${nick}님의 꿈 리포트`, W / 2, 35, { align: 'center' });

    doc.setTextColor(168, 157, 208);
    doc.setFontSize(12);
    doc.text(periodLabel, W / 2, 45, { align: 'center' });
    doc.text(new Date().toLocaleDateString('ko-KR') + ' 생성', W / 2, 52, { align: 'center' });

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

      doc.setFontSize(9);
      doc.setTextColor(200, 191, 248);
      doc.text(`${EMOTION_EMOJI[state]} ${state}`, margin, barY + 4);

      doc.setFillColor(r, g, b);
      doc.roundedRect(margin + 30, barY - 1, Math.max(barW, 2), 6, 2, 2, 'F');

      doc.setTextColor(168, 157, 208);
      doc.setFontSize(8);
      doc.text(`${count} (${pct}%)`, margin + 33 + Math.max(barW, 2), barY + 3);
    });

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

        const intBarW = c.intensity / 100 * 30;
        doc.setFillColor(166, 124, 239);
        doc.roundedRect(contentW + margin - 35, y, intBarW, 6, 1, 1, 'F');

        y += 14;
      });
    }

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

      doc.setFontSize(7);
      doc.setTextColor(107, 94, 138);
      doc.text(l.date || '', margin + 3, y + 4);

      doc.setFontSize(9);
      doc.setTextColor(240, 236, 255);
      doc.text((l.title || 'dream').substring(0, 50), margin + 3, y + 11);

      if (l.badges && l.badges.length) {
        doc.setFontSize(7);
        doc.setTextColor(166, 124, 239);
        doc.text(l.badges.join(' / '), margin + 3, y + 17);
      }

      const emo = classifyEmotion(l);
      doc.setFontSize(8);
      const [r, g, b] = EMOTION_COLORS[emo];
      doc.setTextColor(r, g, b);
      doc.text(`${EMOTION_EMOJI[emo]} ${emo}`, contentW + margin - 25, y + 11);

      y += cardH + 3;
    });

    if (y > H - 25) { doc.addPage(); drawPageBg(); y = 30; }
    doc.setTextColor(168, 157, 208);
    doc.setFontSize(8);
    doc.text('Generated by MONGGEUL - Your Dream Companion', W / 2, H - 15, { align: 'center' });

    doc.save(`monggeul-monthly-report-${year}-${String(month + 1).padStart(2, '0')}.pdf`);
    logEvent('dreams_exported', { format: 'monthly_pdf', count: targetLogs.length, period: periodLabel });
    showToast('월간 리포트 PDF가 다운로드됐어요! 🌙');
  } catch (e) {
    console.error('PDF generation failed:', e);
    showToast('PDF 생성에 실패했어요. 다시 시도해주세요.');
  }
};

// 공유 다운로드 헬퍼 (dream-export.js 에서 import 하여 사용)
export function _downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
