/**
 * MONGGEUL Bot 2 — 커뮤니티 모더레이션
 * 부적절한 콘텐츠 자동 필터링 + 정신건강 경계 원칙 적용.
 */

const SENSITIVE_PATTERNS = [
  /자살|자해|극단적/i,
  /약물.*남용|마약/i,
];

const DISCLAIMER = '힘든 감정이 드신다면 정신건강 위기상담 전화 1577-0199로 연락해주세요.';

function moderateContent(text) {
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(text)) {
      return { safe: false, reason: 'sensitive_content', disclaimer: DISCLAIMER };
    }
  }
  return { safe: true };
}

if (require.main === module) {
  console.log(moderateContent('오늘 꿈에서 하늘을 날았어요'));
  console.log(moderateContent('자살하고 싶은 꿈'));
}

module.exports = { moderateContent, DISCLAIMER };
