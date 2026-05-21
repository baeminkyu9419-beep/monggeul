// 몽글몽글 — OpenAI API 프록시 (Edge Function 전용)
import { store } from '../store.js';

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
  // offline 즉시 fallback (retry 4초 대기 없이 — demoResult 로 바로)
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('인터넷 연결을 확인해 주세요.');
  }
  const url = window.SUPABASE_URL + '/functions/v1/openai-proxy';
  // openai-proxy 는 user JWT(auth.getUser) 필수 → 익명/로그인 세션의 access_token 우선, 없으면 anon key
  let authToken = window.SUPABASE_ANON_KEY || '';
  try {
    if (store.supabase) {
      const { data } = await store.supabase.auth.getSession();
      if (data && data.session && data.session.access_token) authToken = data.session.access_token;
    }
  } catch (e) {}
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + authToken,
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
