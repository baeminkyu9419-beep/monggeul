// 몽글몽글 — OpenAI API 프록시 (Edge Function 전용)

const MAX_RETRIES = 2;
const TIMEOUT_MS = 30000;
const RETRY_DELAYS = [1000, 3000];

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function callOpenAI(endpoint, payload, mode) {
  if (!window.SUPABASE_URL) {
    throw new Error('해몽 기능을 준비 중이에요. 기본 해석을 보여드릴게요 🌙');
  }
  const url = window.SUPABASE_URL + '/functions/v1/openai-proxy';
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + (window.SUPABASE_ANON_KEY || ''),
    },
    // mode 'consensus' = 멀티 LLM 교차검증(프리미엄). 미지정 = fallback 라우팅(무료).
    body: JSON.stringify({ endpoint, payload, mode })
  };

  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(url, options, TIMEOUT_MS);
      if (res.ok) return res.json();
      if (res.status === 429) {
        // 속도 제한 — 대기 후 재시도
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
          continue;
        }
        throw new Error('요청이 너무 많아요. 잠시 후 다시 시도해 주세요.');
      }
      if (res.status >= 500 && attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
      throw new Error('API 요청 실패: ' + res.status);
    } catch (e) {
      lastError = e;
      if (e.name === 'AbortError') {
        lastError = new Error('응답 시간이 초과됐어요. 다시 시도해 주세요.');
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
          continue;
        }
      }
      if (!navigator.onLine) {
        throw new Error('인터넷 연결을 확인해 주세요.');
      }
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
    }
  }
  throw lastError;
}

window.callOpenAI = callOpenAI;
