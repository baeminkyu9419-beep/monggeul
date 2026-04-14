// 몽글몽글 — 상징 변화 추적 (Phase 2-1)
// 같은 상징이 시간에 따라 어떻게 변했는지 추적

const STATE_COLOR = { 평온: '#7de8d8', 불안: '#f8c94c', 공포: '#f0a8c8', 기쁨: '#a67cef', 슬픔: '#90b0ff' };
const STATE_EMOJI = { 평온: '😌', 불안: '😰', 공포: '😱', 기쁨: '😊', 슬픔: '😢' };
const STATES = ['공포', '슬픔', '불안', '평온', '기쁨'];

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

// 상징별 출현 + 감정 변화 데이터 수집
function collectSymbolHistory(logs) {
  const symbols = ['뱀', '물', '불', '이빨', '하늘', '돈', '돼지', '귀신', '달', '꽃', '비', '바다', '산', '차', '집', '학교', '아기', '결혼', '시험', '죽음'];
  const history = {};

  logs.forEach(l => {
    if (!l.text || !l.date) return;
    const emo = classifyEmotion(l);
    symbols.forEach(s => {
      if (l.text.includes(s)) {
        if (!history[s]) history[s] = [];
        history[s].push({
          date: l.date,
          emotion: emo,
          title: l.title || '꿈',
          badges: l.badges || [],
          stateIdx: STATES.indexOf(emo)
        });
      }
    });
  });

  // 2회 이상 등장한 상징만 반환 (최근 순)
  const filtered = {};
  Object.entries(history).forEach(([k, v]) => {
    if (v.length >= 2) filtered[k] = v;
  });
  return filtered;
}

export function renderSymbolTracker(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const logs = JSON.parse(localStorage.getItem('mg_logs') || '[]').filter(l => !l.noDream);
  const history = collectSymbolHistory(logs);
  const entries = Object.entries(history).sort((a, b) => b[1].length - a[1].length).slice(0, 6);

  if (entries.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:11px">같은 상징이 2번 이상 나타나면 변화 추적이 시작돼요</div>';
    return;
  }

  const ns = 'http://www.w3.org/2000/svg';
  let html = '';

  entries.forEach(([symbol, occurrences]) => {
    const count = occurrences.length;
    const first = occurrences[occurrences.length - 1]; // 가장 오래된 (logs는 최신순)
    const last = occurrences[0]; // 가장 최근
    const firstIdx = first.stateIdx;
    const lastIdx = last.stateIdx;
    const diff = lastIdx - firstIdx;
    const trendIcon = diff > 0 ? '📈' : diff < 0 ? '📉' : '➡️';
    const trendColor = diff > 0 ? '#7de8d8' : diff < 0 ? '#f0a8c8' : '#8b8ba0';
    const trendMsg = diff > 0 ? '점점 밝아지는 중' : diff < 0 ? '주의가 필요해요' : '일정한 패턴';

    // 미니 라인차트 (가로)
    const W = 180, H = 36, pad = 4;
    const chartW = W - pad * 2;
    const chartH = H - pad * 2;

    let svgContent = '';
    // 가이드 라인 (점선)
    svgContent += `<line x1="${pad}" y1="${pad + chartH / 2}" x2="${W - pad}" y2="${pad + chartH / 2}" stroke="rgba(255,255,255,.06)" stroke-width="0.5" stroke-dasharray="2,3"/>`;

    // 데이터 포인트와 선
    const pts = occurrences.slice().reverse().map((o, i) => {
      const x = pad + (count <= 1 ? chartW / 2 : (i / (count - 1)) * chartW);
      const y = pad + chartH - (o.stateIdx / (STATES.length - 1)) * chartH;
      return { x, y, color: STATE_COLOR[o.emotion] };
    });

    for (let i = 1; i < pts.length; i++) {
      svgContent += `<line x1="${pts[i - 1].x}" y1="${pts[i - 1].y}" x2="${pts[i].x}" y2="${pts[i].y}" stroke="${pts[i].color}" stroke-width="1.5" stroke-opacity="0.6"/>`;
    }
    pts.forEach(p => {
      svgContent += `<circle cx="${p.x}" cy="${p.y}" r="3" fill="${p.color}" stroke="#0e0c1a" stroke-width="1"/>`;
    });

    html += `<div style="display:flex;align-items:center;gap:10px;padding:10px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.05);border-radius:12px;margin-bottom:8px">
      <div style="min-width:52px;text-align:center">
        <div style="font-size:18px">${getSymbolEmoji(symbol)}</div>
        <div style="font-size:10px;font-weight:700;color:var(--text-secondary)">${symbol}</div>
        <div style="font-size:9px;color:var(--text-muted)">${count}회</div>
      </div>
      <div style="flex:1">
        <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="max-width:100%">${svgContent}</svg>
      </div>
      <div style="min-width:60px;text-align:right">
        <div style="font-size:12px">${trendIcon}</div>
        <div style="font-size:9px;color:${trendColor};font-weight:600">${trendMsg}</div>
        <div style="font-size:8px;color:var(--text-muted)">${STATE_EMOJI[first.emotion]}→${STATE_EMOJI[last.emotion]}</div>
      </div>
    </div>`;
  });

  // 전체 인사이트
  const totalSymbols = entries.length;
  const improving = entries.filter(([, o]) => o[0].stateIdx > o[o.length - 1].stateIdx).length;
  const worsening = entries.filter(([, o]) => o[0].stateIdx < o[o.length - 1].stateIdx).length;
  let insight = '';
  if (improving > worsening) {
    insight = '💬 대부분의 반복 상징이 긍정적으로 변하고 있어요. 무의식이 치유 중이에요.';
  } else if (worsening > improving) {
    insight = '💬 일부 상징의 감정이 무거워지고 있어요. 달이에게 이야기해보세요.';
  } else {
    insight = '💬 상징들의 감정이 안정적인 흐름을 유지하고 있어요.';
  }

  container.innerHTML = '<div style="font-size:12px;font-weight:700;color:var(--purple-bright);margin-bottom:10px">🔍 상징 변화 추적</div>'
    + html
    + '<div style="font-size:11px;color:var(--text-secondary);padding:8px 0;line-height:1.5">' + insight + '</div>';
}

function getSymbolEmoji(symbol) {
  const map = { 뱀: '🐍', 물: '💧', 불: '🔥', 이빨: '🦷', 하늘: '☁️', 돈: '💰', 돼지: '🐷', 귀신: '👻', 달: '🌙', 꽃: '🌸', 비: '🌧️', 바다: '🌊', 산: '⛰️', 차: '🚗', 집: '🏠', 학교: '🏫', 아기: '👶', 결혼: '💒', 시험: '📝', 죽음: '💀' };
  return map[symbol] || '✦';
}

window.renderSymbolTracker = renderSymbolTracker;
