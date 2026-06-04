// 빌드 후 dist/config.js 생성 — 배포 환경변수(Render envVars 등) → window.* 주입.
// 이유: config.js 는 .gitignore 라 fresh clone(Render) 시 부재 → 프로덕션에서 config.js 404
//   → SUPABASE_URL 미정의 → 인증/LLM/결제/커뮤니티 무음 강등. 빌드마다 생성해 404를 차단한다.
// 값은 전부 공개값(Supabase URL/anon · AdSense pub · GA · VAPID public)이라 안전하다.
//   LLM 키/시스템 프롬프트는 edge function(openai-proxy) 서버에만 존재 — 여기 없음.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEYS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'GA_ID', 'VAPID_PUBLIC_KEY', 'ADSENSE_CLIENT', 'ADSENSE_SLOT'];

const lines = KEYS.map(k => `window.${k} = ${JSON.stringify(process.env[k] || '')};`);
const out = `// [자동생성] scripts/gen-config.js — 배포 환경변수 주입. 직접 수정하지 마세요.\n${lines.join('\n')}\n`;

const dest = path.join(__dirname, '..', 'dist', 'config.js');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out, 'utf-8');

const status = KEYS.map(k => `${k}=${process.env[k] ? 'set' : 'EMPTY'}`).join(' ');
console.log(`[gen-config] dist/config.js 생성 — ${status}`);
