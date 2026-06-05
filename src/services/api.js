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

// 폴백 사유를 error 에 태깅 — 호출부(dream.js)가 demoResult(inp, reason) 로 명시 전달해
// 결과 객체에 engine/fallbackReason 을 박는다. "왜 LLM 이 아니라 폴백인지"를 절대 숨기지 않는다.
function _fbErr(reason, msg) { const e = new Error(msg); e.fallbackReason = reason; return e; }

// 내부 공통 전송기. body 는 호출자가 구성(chat=task/params, image=payload).
// [라우팅 원칙] window.SUPABASE_URL '유무'로 LLM 가능 여부를 추측하지 않는다.
//   endpoint 가 없으면 그것 자체가 명시적 실패(no_supabase_url)로 태깅돼 폴백되고,
//   있으면 실제 호출 결과(성공=LLM / 실패=태깅된 폴백)로만 판단한다.
async function _proxyFetch(body) {
  if (!window.SUPABASE_URL) {
    throw _fbErr('no_supabase_url', '해몽 백엔드(SUPABASE_URL)가 설정되지 않았어요.');
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw _fbErr('offline', '인터넷 연결을 확인해 주세요.');
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
    body: JSON.stringify(body)
  };
  return _withRetry(url, options);
}

// [보안: 프롬프트 IP 서버 격리]
// chat 호출은 시스템 프롬프트를 클라가 보내지 않는다. task(어떤 프롬프트 템플릿) + params(사용자
// 데이터)만 전송하고, edge function(openai-proxy/prompts.ts)이 시스템 프롬프트를 조립해 LLM 호출.
// → dist 번들에 프롬프트 문자열이 더 이상 존재하지 않음(DevTools 탈취 차단).
// mode 'consensus' = 멀티 LLM 교차검증(프리미엄). 미지정 = fallback 라우팅(무료).
export async function callChat(task, params, mode) {
  return _proxyFetch({ endpoint: 'chat', task, params, mode });
}

// image(DALL-E) 전용 — payload = 이미지 스타일 프롬프트(해석 IP 아님).
export async function callOpenAI(endpoint, payload, mode) {
  if (endpoint === 'chat') {
    // 하위호환 안전장치: chat 은 callChat 으로 가야 한다. 잘못 호출되면 명시적 에러.
    throw new Error('chat 호출은 callChat(task, params, mode) 를 사용하세요.');
  }
  return _proxyFetch({ endpoint, payload, mode });
}

async function _withRetry(url, options) {

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
        throw _fbErr('rate_limited', '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.');
      }
      // 503 = 기능 비활성(예: image 생성 OFF) → 복구 불가, retry 무의미. 즉시 throw.
      if (res.status >= 500 && res.status !== 503 && attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
      // HTTP 상태별 정확한 폴백 사유 — '왜 LLM 이 아닌지'를 구체적으로 남긴다.
      const _reason = res.status === 401 || res.status === 403 ? 'invalid_anon_key'
        : res.status === 404 ? 'edge_function_not_found'
        : res.status === 503 ? 'llm_provider_unavailable'
        : res.status >= 500 ? 'llm_provider_error'
        : 'http_' + res.status;
      throw _fbErr(_reason, 'API 요청 실패: ' + res.status);
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
        throw _fbErr('offline', '인터넷 연결을 확인해 주세요.');
      }
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
    }
  }
  // 모든 재시도 소진 — 사유 미태깅이면 일반 호출실패로 표시(네트워크/CORS/함수부재/타임아웃 등)
  if (lastError && !lastError.fallbackReason) lastError.fallbackReason = 'llm_call_failed';
  throw lastError;
}

window.callOpenAI = callOpenAI;
window.callChat = callChat;
