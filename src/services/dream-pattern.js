// 몽글몽글 — 꿈 패턴 엔진 (NAEUM Markov + Forecast 융합)

// ── 감정 상태 정의 (Markov 상태) ──
const STATES = ['평온', '불안', '공포', '기쁨', '슬픔'];

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

// ── Markov 전이 행렬 계산 ──
function buildTransitionMatrix(logs) {
  const counts = {};
  STATES.forEach(s => { counts[s] = {}; STATES.forEach(t => { counts[s][t] = 0; }); });

  for (let i = 0; i < logs.length - 1; i++) {
    const from = classifyEmotion(logs[i]);
    const to = classifyEmotion(logs[i + 1]);
    counts[from][to]++;
  }

  // 정규화 → 확률
  const matrix = {};
  STATES.forEach(s => {
    const total = Object.values(counts[s]).reduce((a, b) => a + b, 0);
    matrix[s] = {};
    STATES.forEach(t => {
      matrix[s][t] = total > 0 ? Math.round(counts[s][t] / total * 100) : 0;
    });
  });
  return matrix;
}

// ── 다음 꿈 감정 예측 ──
function predictNextState(logs) {
  if (logs.length < 3) return null;
  const matrix = buildTransitionMatrix(logs);
  const current = classifyEmotion(logs[0]); // 가장 최근 꿈
  const probs = matrix[current];

  // 가장 높은 전이 확률
  let best = '평온', bestP = 0;
  STATES.forEach(s => { if (probs[s] > bestP) { best = s; bestP = probs[s]; } });

  return { current, predicted: best, probability: bestP, matrix };
}

// ── 반복꿈 클러스터 감지 ──
function detectRecurringClusters(logs) {
  if (logs.length < 3) return [];

  const clusters = [];
  const kwMap = {};

  // 키워드별 등장 날짜 수집
  logs.forEach((l, i) => {
    const kws = [...(l.keywords || []), ...(l.badges || [])];
    kws.forEach(k => {
      if (!kwMap[k]) kwMap[k] = [];
      kwMap[k].push({ idx: i, date: l.date });
    });
  });

  // 3회 이상 등장한 키워드 = 반복 클러스터
  Object.entries(kwMap).forEach(([kw, entries]) => {
    if (entries.length >= 3) {
      // 간격 계산 (일 단위)
      const dates = entries.map(e => new Date(e.date).getTime()).filter(d => !isNaN(d)).sort((a, b) => b - a);
      const intervals = [];
      for (let i = 0; i < dates.length - 1; i++) {
        intervals.push(Math.round((dates[i] - dates[i + 1]) / (1000 * 60 * 60 * 24)));
      }
      const avgInterval = intervals.length > 0 ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length) : 0;

      // 다음 발생 예측
      const lastDate = dates[0];
      const predictedNext = lastDate + avgInterval * 24 * 60 * 60 * 1000;
      const daysUntil = Math.max(0, Math.round((predictedNext - Date.now()) / (1000 * 60 * 60 * 24)));

      clusters.push({
        keyword: kw,
        count: entries.length,
        avgInterval,
        daysUntil,
        intensity: Math.min(100, Math.round(entries.length / logs.length * 100 * 3)),
      });
    }
  });

  return clusters.sort((a, b) => b.count - a.count).slice(0, 5);
}

// ── 꿈 빈도 트렌드 (시계열 예측) ──
function forecastFrequency(logs) {
  if (logs.length < 5) return null;

  // 주간 빈도 계산 (최근 4주)
  const now = Date.now();
  const weeklyCount = [0, 0, 0, 0];
  logs.forEach(l => {
    const d = new Date(l.date).getTime();
    if (isNaN(d)) return;
    const weeksAgo = Math.floor((now - d) / (7 * 24 * 60 * 60 * 1000));
    if (weeksAgo >= 0 && weeksAgo < 4) weeklyCount[weeksAgo]++;
  });

  // 단순 선형 성장률
  const recent = weeklyCount[0] + weeklyCount[1];
  const prior = weeklyCount[2] + weeklyCount[3];
  const growthRate = prior > 0 ? Math.round((recent - prior) / prior * 100) : 0;
  const trend = growthRate > 20 ? 'increasing' : growthRate < -20 ? 'decreasing' : 'stable';

  return { weeklyCount, growthRate, trend };
}

// ── 종합 패턴 리포트 ──
export function generatePatternReport(logs) {
  if (!logs || logs.length < 3) return null;

  const prediction = predictNextState(logs);
  const clusters = detectRecurringClusters(logs);
  const frequency = forecastFrequency(logs);

  // 감정 분포
  const emotionDist = {};
  STATES.forEach(s => { emotionDist[s] = 0; });
  logs.forEach(l => { emotionDist[classifyEmotion(l)]++; });

  return {
    prediction,
    clusters,
    frequency,
    emotionDist,
    totalDreams: logs.length,
    states: STATES,
  };
}

window.generatePatternReport = generatePatternReport;
