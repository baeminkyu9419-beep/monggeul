/**
 * MONGGEUL Bot 1 — 꿈 분석 봇
 * 저장된 꿈 데이터에서 반복 패턴 감지 + 상징 사전 자동 매칭.
 */
const fs = require('fs');
const path = require('path');

function analyzeDreams(dreams = []) {
  console.log(`[Bot1] 꿈 분석 시작: ${dreams.length}건`);

  const keywords = {};
  for (const dream of dreams) {
    const words = (dream.text || '').split(/\s+/);
    for (const w of words) {
      if (w.length >= 2) keywords[w] = (keywords[w] || 0) + 1;
    }
  }

  const recurring = Object.entries(keywords)
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1]);

  return { analyzed: dreams.length, recurring_keywords: recurring.slice(0, 10) };
}

if (require.main === module) {
  const r = analyzeDreams([
    { text: '높은 곳에서 떨어지는 꿈' },
    { text: '높은 빌딩에서 떨어지는 꿈' },
    { text: '높은 산에서 떨어지는 꿈' },
  ]);
  console.log(JSON.stringify(r, null, 2));
}

module.exports = { analyzeDreams };
