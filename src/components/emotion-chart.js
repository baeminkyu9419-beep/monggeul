// 몽글몽글 — 감정 흐름 그래프 (5상태 색상 라인차트)
// Phase 2-1: 최근 30일 감정 흐름을 5상태(평온/불안/공포/기쁨/슬픔) 라인차트로 시각화

const STATES = ['공포', '슬픔', '불안', '평온', '기쁨']; // 아래→위 (부정→긍정)
const STATE_EMOJI = { 평온: '😌', 불안: '😰', 공포: '😱', 기쁨: '😊', 슬픔: '😢' };
const STATE_COLOR = { 평온: '#7de8d8', 불안: '#f8c94c', 공포: '#f0a8c8', 기쁨: '#a67cef', 슬픔: '#90b0ff' };

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

export function renderEmotionFlowChart(containerId, days) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const logs = JSON.parse(localStorage.getItem('mg_logs') || '[]').filter(l => !l.noDream);
  const ns = 'http://www.w3.org/2000/svg';

  // 최근 N일 날짜 범위 생성
  const today = new Date();
  const dateRange = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dateRange.push(d.toISOString().split('T')[0]);
  }

  // 각 날짜별 감정 상태 매핑
  const dateEmotions = {};
  logs.forEach(l => {
    const d = (l.date || '').split(' ')[0]; // "2026-04-07" 형태
    if (!d) return;
    // 날짜 정규화 (한국어 날짜 형식 대응)
    let norm = d;
    if (d.includes('.')) {
      const parts = d.split('.');
      if (parts.length >= 3) norm = parts[0].trim() + '-' + parts[1].trim().padStart(2, '0') + '-' + parts[2].trim().padStart(2, '0');
    }
    if (!dateEmotions[norm]) dateEmotions[norm] = [];
    dateEmotions[norm].push(classifyEmotion(l));
  });

  // 데이터 포인트: 꿈이 있는 날만
  const points = [];
  dateRange.forEach((date, idx) => {
    const emotions = dateEmotions[date];
    if (emotions && emotions.length > 0) {
      // 해당 날짜에 가장 많은 감정 (다수 기록 시)
      const freq = {};
      emotions.forEach(e => { freq[e] = (freq[e] || 0) + 1; });
      const dominant = Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0];
      points.push({ date, idx, state: dominant, stateIdx: STATES.indexOf(dominant) });
    }
  });

  if (points.length < 2) {
    container.innerHTML = '<div style="text-align:center;padding:30px 10px;color:var(--text-muted);font-size:12px">꿈 기록 2개 이상이면 감정 흐름 차트가 나타나요</div>';
    return;
  }

  // SVG 차트 렌더링
  const W = 340, H = 180, padL = 36, padR = 12, padT = 14, padB = 28;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', H);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.style.maxWidth = '100%';

  // 배경 수평 가이드 (5상태)
  STATES.forEach((s, i) => {
    const y = padT + chartH - (i / (STATES.length - 1)) * chartH;
    // 가이드 라인
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', padL);
    line.setAttribute('y1', y);
    line.setAttribute('x2', W - padR);
    line.setAttribute('y2', y);
    line.setAttribute('stroke', 'rgba(255,255,255,.04)');
    line.setAttribute('stroke-width', '0.5');
    svg.appendChild(line);
    // 라벨
    const label = document.createElementNS(ns, 'text');
    label.setAttribute('x', padL - 4);
    label.setAttribute('y', y + 1);
    label.setAttribute('text-anchor', 'end');
    label.setAttribute('dominant-baseline', 'central');
    label.setAttribute('font-size', '8');
    label.setAttribute('fill', STATE_COLOR[s]);
    label.setAttribute('font-family', 'Noto Sans KR, sans-serif');
    label.textContent = STATE_EMOJI[s];
    svg.appendChild(label);
  });

  // 그라데이션 정의
  const defs = document.createElementNS(ns, 'defs');
  points.forEach((p, i) => {
    if (i === 0) return;
    const prev = points[i - 1];
    const grad = document.createElementNS(ns, 'linearGradient');
    grad.setAttribute('id', 'eGrad' + i);
    grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
    grad.setAttribute('x2', '1'); grad.setAttribute('y2', '0');
    const s1 = document.createElementNS(ns, 'stop');
    s1.setAttribute('offset', '0%');
    s1.setAttribute('stop-color', STATE_COLOR[prev.state]);
    const s2 = document.createElementNS(ns, 'stop');
    s2.setAttribute('offset', '100%');
    s2.setAttribute('stop-color', STATE_COLOR[p.state]);
    grad.appendChild(s1); grad.appendChild(s2);
    defs.appendChild(grad);
  });
  svg.appendChild(defs);

  // 좌표 계산
  function getXY(point) {
    const x = padL + (point.idx / (days - 1)) * chartW;
    const y = padT + chartH - (point.stateIdx / (STATES.length - 1)) * chartH;
    return { x, y };
  }

  // 면적 채우기 (아래쪽 그라데이션)
  const areaPoints = points.map(p => getXY(p));
  if (areaPoints.length >= 2) {
    const areaPath = areaPoints.map((p, i) => i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`).join(' ')
      + ` L${areaPoints[areaPoints.length - 1].x},${padT + chartH} L${areaPoints[0].x},${padT + chartH} Z`;
    const area = document.createElementNS(ns, 'path');
    area.setAttribute('d', areaPath);
    area.setAttribute('fill', 'rgba(166,124,239,.06)');
    svg.appendChild(area);
  }

  // 선분 (그라데이션 색상 전환)
  for (let i = 1; i < points.length; i++) {
    const prev = getXY(points[i - 1]);
    const cur = getXY(points[i]);
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', prev.x); line.setAttribute('y1', prev.y);
    line.setAttribute('x2', cur.x); line.setAttribute('y2', cur.y);
    line.setAttribute('stroke', `url(#eGrad${i})`);
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linecap', 'round');
    svg.appendChild(line);
  }

  // 데이터 포인트
  points.forEach(p => {
    const { x, y } = getXY(p);
    const glow = document.createElementNS(ns, 'circle');
    glow.setAttribute('cx', x); glow.setAttribute('cy', y);
    glow.setAttribute('r', '6');
    glow.setAttribute('fill', STATE_COLOR[p.state]);
    glow.setAttribute('opacity', '0.2');
    svg.appendChild(glow);
    const dot = document.createElementNS(ns, 'circle');
    dot.setAttribute('cx', x); dot.setAttribute('cy', y);
    dot.setAttribute('r', '3.5');
    dot.setAttribute('fill', STATE_COLOR[p.state]);
    dot.setAttribute('stroke', '#0e0c1a');
    dot.setAttribute('stroke-width', '1.5');
    svg.appendChild(dot);
  });

  // X축 날짜 라벨 (간격 조절)
  const labelInterval = days <= 7 ? 1 : days <= 14 ? 2 : 5;
  dateRange.forEach((date, idx) => {
    if (idx % labelInterval !== 0 && idx !== days - 1) return;
    const x = padL + (idx / (days - 1)) * chartW;
    const t = document.createElementNS(ns, 'text');
    t.setAttribute('x', x);
    t.setAttribute('y', H - 4);
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('font-size', '7');
    t.setAttribute('fill', 'rgba(255,255,255,.25)');
    t.setAttribute('font-family', 'sans-serif');
    t.textContent = date.substring(5); // MM-DD
    svg.appendChild(t);
  });

  // 컨테이너 렌더링
  container.innerHTML = '';
  container.appendChild(svg);

  // 범례
  const legend = document.createElement('div');
  legend.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:8px';
  STATES.slice().reverse().forEach(s => {
    const item = document.createElement('span');
    item.style.cssText = 'display:flex;align-items:center;gap:3px;font-size:10px;color:var(--text-muted)';
    item.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:' + STATE_COLOR[s] + ';display:inline-block"></span>' + STATE_EMOJI[s] + ' ' + s;
    legend.appendChild(item);
  });
  container.appendChild(legend);

  // 감정 변화 요약
  if (points.length >= 3) {
    const recent3 = points.slice(-3);
    const firstHalf = points.slice(0, Math.ceil(points.length / 2));
    const secondHalf = points.slice(Math.ceil(points.length / 2));
    const avgFirst = firstHalf.reduce((s, p) => s + p.stateIdx, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, p) => s + p.stateIdx, 0) / secondHalf.length;
    const trend = avgSecond - avgFirst;

    const summary = document.createElement('div');
    summary.style.cssText = 'margin-top:10px;padding:10px 12px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:10px;font-size:11px;color:var(--text-secondary);line-height:1.6';

    const trendIcon = trend > 0.5 ? '📈' : trend < -0.5 ? '📉' : '➡️';
    const trendMsg = trend > 0.5 ? '감정이 밝아지고 있어요!' : trend < -0.5 ? '최근 무거운 감정이 늘었어요. 달이에게 이야기해보세요.' : '감정 흐름이 안정적이에요.';
    const dominant = {};
    points.forEach(p => { dominant[p.state] = (dominant[p.state] || 0) + 1; });
    const topState = Object.entries(dominant).sort((a, b) => b[1] - a[1])[0];

    summary.innerHTML = trendIcon + ' ' + trendMsg
      + '<br><span style="color:' + STATE_COLOR[topState[0]] + '">' + STATE_EMOJI[topState[0]] + ' ' + topState[0] + '</span> 감정이 가장 많았어요 (' + topState[1] + '/' + points.length + '일)';
    container.appendChild(summary);
  }
}

window.renderEmotionFlowChart = renderEmotionFlowChart;
