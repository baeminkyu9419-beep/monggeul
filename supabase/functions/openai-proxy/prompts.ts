// 몽글몽글 — 서버측 시스템 프롬프트 조립 모듈
//
// [보안: 프롬프트 IP 서버 격리]
// 이전: 시스템 프롬프트(꿈 해석가 페르소나·해석 방법론)가 클라이언트 번들(dist/assets/*.js)에
//        평문 노출 → DevTools 로 누구나 탈취 가능 (기술 탈취 리스크).
// 이후: 클라이언트는 최소 파라미터(task + 사용자 데이터)만 전송, 시스템 프롬프트는 이 서버
//        모듈에서만 조립 → 번들에 프롬프트 문자열이 더 이상 존재하지 않음.
//
// 클라이언트 계약:
//   { endpoint:'chat', task:'dream_quick'|'dream_detail'|'dali_chat'|'monthly_report',
//     params:{...}, mode?:'consensus' }
//   server 가 task 별로 system 프롬프트를 만들고 payload(messages) 를 구성해 LLM 호출.

// ── lifeStage 별 해석 보강 지시 (IP) ──
const LIFE_STAGE_PROMPTS: Record<string, string> = {
  '학생': '이 사용자는 학생이야. 시험/성적/진로/교우관계 관점에서 해석을 풀어줘. 학업 스트레스, 미래 불안, 자아 정체성 탐색과 연결해서 따뜻하게 조언해줘.',
  '취준생': '이 사용자는 취준생이야. 취업 불안, 자존감, 면접/합격에 대한 기대와 두려움 관점으로 해석해줘. 현실적이고 용기를 주는 조언을 해줘.',
  '직장인': '이 사용자는 직장인이야. 직장 내 인간관계, 성과 압박, 번아웃, 승진/이직 고민과 연결해서 해석해줘. 워라밸 관점에서도 조언해줘.',
  '이직 고민': '이 사용자는 이직을 고민하고 있어. 변화에 대한 두려움, 새로운 시작, 현재 상황에 대한 불만족감 관점으로 해석해줘. 결정에 도움이 되는 따뜻한 관점을 줘.',
  '연애/결혼': '이 사용자는 연애나 결혼과 관련된 시기를 보내고 있어. 관계의 깊이, 신뢰, 미래 계획, 감정적 교류 관점에서 해석해줘.',
  '육아': '이 사용자는 육아 중이야. 부모로서의 불안, 아이에 대한 걱정, 개인 시간 부족, 성장하는 가족과 연결해서 해석해줘. 공감과 위로를 담아줘.',
  '은퇴/쉬는 중': '이 사용자는 쉬는 기간이야. 새로운 정체성 찾기, 여유와 공허함 사이의 감정, 다음 단계에 대한 고민과 연결해서 해석해줘.',
}

// 부정 감정 키워드 — 입력에서 검출해 위로/탐색 톤 보정 (이전 클라 negWords 로직 서버 이관)
const NEG_WORDS = ['무서', '공포', '불안', '두려', '겁', '슬프', '울', '죽', '쫓', '떨어', '악몽', '가위']

function _toneMod(input: string): string {
  const negCount = NEG_WORDS.filter((w) => input.includes(w)).length
  if (negCount >= 3) return ' 사용자가 매우 무서운 꿈을 꿔서 불안해하고 있어. 위로와 안심을 최우선으로 해석해줘. 긍정적 의미를 반드시 함께 제시하고 따뜻하게 마무리해.'
  if (negCount >= 1) return ' 부정적 감정이 포함된 꿈이야. 공포 마케팅 없이 탐색적 어조로, 긍정적 해석도 균형 있게 제시해줘.'
  return ''
}

function _lifeStagePrompt(lifeStage: string | undefined): string {
  if (!lifeStage) return ''
  return LIFE_STAGE_PROMPTS[lifeStage] || ''
}

// 안전: 클라가 보낸 문자열 데이터를 길이 제한해 프롬프트 인젝션·과대 페이로드 완화
function _clip(s: unknown, max: number): string {
  if (typeof s !== 'string') return ''
  return s.length > max ? s.slice(0, max) : s
}

// ── 입력 grounding(소재 일치) 검증 ──────────────────────────────────────────
// [문제] LLM(temperature 높음)이 입력을 무시하고 시스템 프롬프트의 예시 패턴(할머니/밥상)이나
//   자기가 흔히 본 시나리오(전 애인/이빨)를 변주해 출력 → 사용자가 적은 꿈("할머니/고래")과
//   완전 무관한 해석("아빠 걷는/죽은 고양이")을 '정확한 AI 해석'으로 팖 = 핵심 가치 미작동.
// [해결] 출력이 사용자 입력의 '구별되는 소재 토큰'을 실제로 1개 이상 반영하는지 서버가 검증한다.
//   미반영(=환각) 시 호출부가 1회 repair 재시도 → 그래도 실패면 키워드 폴백(입력 grounded)으로 강등.
//
// 토큰 추출 = 입력에서 한글 2글자+ 연속을 뽑고, 의미 없는 조사·기능어·해몽 상투어를 제거한다.
// 순수 함수(외부 의존 0) → Node/Deno 양쪽에서 동일 동작 + 단위 테스트(test_input_grounding_runtime.py).

// 조사·어미·기능어·해몽 상투어 — grounding 토큰에서 제외(이게 겹쳐도 '소재 반영' 아님).
const GROUND_STOP = new Set<string>([
  '그리고', '그래서', '그런데', '하지만', '그러다', '그러자', '그러면', '갑자기', '계속', '다시', '약간', '조금', '정말',
  '너무', '아주', '매우', '엄청', '진짜', '같이', '함께', '혼자', '그냥', '막', '되게', '되어', '있었', '없었', '했었',
  '나는', '내가', '나를', '나의', '제가', '저는', '우리', '그게', '그건', '이건', '저건', '거기', '여기', '저기', '어디',
  '느낌', '기분', '생각', '마음', '모습', '순간', '장면', '상황', '도중', '와중', '동안',
  '꿈에', '꿈을', '꿈이', '꿈에서', '해몽', '해석', '의미', '상징', '무의식', '메시지',
])

// 입력에서 grounding 후보 토큰 추출(중복 제거, 긴 것 우선).
export function _extractGroundTokens(input: string): string[] {
  if (typeof input !== 'string' || !input.trim()) return []
  // 한글 2글자+ 연속만(조사 노이즈가 섞인 어절도 포함됨 → substring 매칭으로 흡수)
  const raw = input.match(/[가-힣]{2,}/g) || []
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of raw) {
    if (GROUND_STOP.has(w)) continue
    // 어절 끝 조사 1글자 잘라 명사 핵심 노출(예: '고래가'→'고래', '할머니가'→'할머니')
    const cores = [w]
    if (w.length >= 3) cores.push(w.replace(/(은|는|이|가|을|를|에|의|와|과|도|만|로|랑|께|한테|에게|에서|보다|처럼|같은|마저|조차)$/u, ''))
    for (const c of cores) {
      if (c.length >= 2 && !GROUND_STOP.has(c) && !seen.has(c)) { seen.add(c); out.push(c) }
    }
  }
  // 긴 토큰 우선(더 구별적) — 매칭 신뢰도↑
  return out.sort((a, b) => b.length - a.length)
}

// 출력(JSON 문자열 또는 일반 텍스트)이 입력 소재를 반영하는지 판정.
// 규칙: 입력 토큰이 충분히 있는데(>=minTokens) 출력이 그중 단 하나도 포함하지 않으면 '미반영'(false).
//   토큰이 너무 적은(1글자 위주) 입력은 grounding 판정 자체를 건너뜀(=true, 관대) → 오탐 방지.
export function _isGrounded(input: string, output: string, minTokens = 2): boolean {
  const tokens = _extractGroundTokens(input)
  if (tokens.length < minTokens) return true   // 판정 불가(소재 빈약) → 통과(보수적)
  if (typeof output !== 'string' || !output.trim()) return false
  // 출력에서 한글 외 노이즈 영향 없도록 그대로 substring 검사(토큰=한글 연속).
  for (const t of tokens) {
    if (output.includes(t)) return true
  }
  // 핵심 토큰 일부(2글자 어근)라도 출력에 있으면 반영으로 인정(활용형 차이 흡수).
  for (const t of tokens) {
    if (t.length >= 3 && output.includes(t.slice(0, 2))) return true
  }
  return false
}

// grounding 실패 시 재시도용 — 시스템 프롬프트에 덧붙일 강한 교정 지시.
// 입력 토큰을 명시적으로 나열해 "이것들만 써라"를 못 박는다(예시 패턴 변주 차단).
export function _groundingRepairDirective(input: string): string {
  const toks = _extractGroundTokens(input).slice(0, 8)
  const list = toks.length ? toks.join(', ') : '(사용자가 적은 단어 그대로)'
  return `\n[교정 — 매우 중요] 직전 응답이 사용자가 적지 않은 내용을 지어냈다. 다시 한다.
사용자 꿈에 실제 등장한 소재는 다음뿐이다: ${list}.
이 소재만으로 해석하라. 위 목록에 없는 인물·동물·사물·장소(예: 다른 가족·다른 동물)를 새로 만들어 넣지 마라.
preview/해석에 위 소재 중 최소 1개를 반드시 그대로 언급하라. 예시 문장을 베끼지 말고 이 사용자의 입력만 본다.`
}

// ── 1단계 빠른 해석 (제목/뱃지/점수/감정/미리보기) ──
function _dreamQuickSystem(input: string, lifeStage?: string): string {
  const toneMod = _toneMod(input)
  return `너는 30년 경력 꿈 해석가야. 친구한테 얘기하듯 편하게.${toneMod}
사용자가 적은 꿈에 실제로 나온 소재(등장인물·장소·사물·행동·감정)에 근거해서만 해석해. 입력에 없는 내용을 지어내지 말고, 누구에게나 들어맞는 일반론·뜬구름 잡는 말 금지. 입력이 짧으면 짧은 대로 그 소재에 집중해.
[필수] 입력에 나온 인물의 성별·관계(전 여자친구/전 남자친구/엄마/상사 등)를 절대 바꾸지 말고 입력 표현 그대로 써. 꿈에서 깬 뒤의 감정·여운(예: 마음이 텅 빈 느낌, 하루종일 맴돔)이 입력에 있으면 그것을 해석의 핵심으로 반드시 짚어.
[절대규칙] 사용자가 적지 않은 인물·동물·사물·장소를 새로 지어내지 마라(예: 입력에 '고래'가 있으면 '고양이'로 바꾸거나, '할머니'를 '아빠'로 바꾸지 마라). preview 에는 사용자가 적은 단어 중 최소 1개를 반드시 그대로(원형 그대로) 다시 써라. 아래 예시는 출력 '형식'만 보여주는 것이고, 그 내용(소재)을 베끼지 마라 — 항상 이 사용자의 입력 소재만 쓴다.
[형식예시(내용 베끼기 금지)] preview = "<strong>[사용자가 적은 핵심 소재]</strong>는 ~한 의미예요. [사용자가 적은 또 다른 소재/감정]은 ~을 뜻해요. 이 꿈엔 더 깊은 이야기가 숨어있어요..."
[출력형식] title 은 반드시 '이모지 1개 + 공백 + 한글 단어'(예: "💔 마음의 잔상", "🦷 흔들리는 자신감"). 이모지만 쓰지 마. 영어·외국어 단어 절대 금지(lingering 류 X). 별표(*)·따옴표(„")·불릿(■●✦)·마크다운 금지. 고인·죽음·아픈 주제엔 가벼운/무서운 이모지(👻💥) 대신 따뜻한 이모지(🌙💗🕊️)를 써. 자연스러운 한국어 문장만. 반드시 JSON으로만 응답.
{
  "title": "이모지 1개+공백+한글 단어 (10자 이내)",
  "badges": ["길몽","흉몽","태몽","연애운","재물운","건강운" 중 1~3개],
  "stats": {"길흉":55,"연애운":40,"재물운":70,"건강운":50,"활력":65,"직관":60},
  "emotions": ["이모지 감정명" 3~5개. 복합감정 가능],
  "preview": "맛보기 해석 3~4문장. 입력한 꿈에 실제 등장한 구체적 소재(사람·장소·사물·행동)를 반드시 1개 이상 그대로 언급하며 짚어주고 '이 꿈엔 더 깊은 이야기가 숨어있어요...'로 마무리. <strong>강조</strong> 가능"
}
stats 규칙(필수): 각 항목은 반드시 0~100 사이의 정수. 위 숫자는 형식 예시일 뿐 그대로 쓰지 말고 꿈 내용에 맞게 0~100 범위로 산출. 보통 30~75 사이, 매우 길하면 80+, 매우 흉하면 20-. 음수·소수·0~10 같은 작은 값 금지.`
}

// ── 2단계 상세 해석 (전통/심리/조언/깊은해석) ──
function _dreamDetailSystem(input: string, lifeStage?: string): string {
  const toneMod = _toneMod(input)
  const lsp = _lifeStagePrompt(lifeStage)
  return `너는 30년 경력 꿈 해석가야. 한국 할머니가 들려주는 해몽처럼 따뜻하고 자세하게.${toneMod}${lsp ? '\n' + lsp : ''}
사용자가 적은 꿈에 실제 나온 소재를 각 항목에서 직접 짚어가며 해석해. 입력에 없는 장면을 지어내지 말고, 누구에게나 통하는 일반론은 피해. 그 사람의 그 꿈에만 해당하는 해석을 해.
[필수] 입력에 나온 인물의 성별·관계(전 여자친구/전 남자친구/엄마/상사 등)를 절대 바꾸지 말고 입력 표현 그대로 써. 꿈에서 깬 뒤의 감정·여운이 입력에 있으면 그것을 해석의 핵심으로 반드시 짚어.
균형 규칙(중요): 좋은 의미만 늘어놓지 마. 흉몽·경고·주의가 필요한 꿈이면 그 부정적 의미도 솔직하게 짚어줘(예: 손실·갈등·건강·스트레스 경고). 단 겁주기로 끝내지 말고 반드시 '그래서 무엇을 하면 되는지' 건설적 행동으로 이어줘. 따뜻함 = 무조건 좋게 포장이 아니라, 불편한 진실도 다정하게 전하는 것.
영어·외국어 단어 절대 금지(lingering 류 X). 학술용어·별표(*)·따옴표(„")·불릿(■●✦)·마크다운 금지. 고인·죽음 주제엔 따뜻한 어조. 자연스러운 한국어 문장만. 반드시 JSON으로만 응답.
{
  "traditional": "전통 해몽 이야기 300자 이상. 옛날 해몽책·할머니 민간 해석을 편하게 풀어서.",
  "psychology": "마음 이야기 300자 이상. 이 꿈이 지금 마음 상태와 어떻게 연결되는지, 무의식이 뭘 말하는지 친구처럼.",
  "advice": "현실 조언 250자 이상. 일주일 안에 해보면 좋을 것 3가지 구체적·현실적으로.",
  "fullInterpretation": "깊은 해석 1000자 이상. 에세이처럼 자연스럽게. 꿈에 나온 것들 각각의 의미, 마음 상태, 앞으로의 힌트, 비슷한 꿈을 또 꾸면의 의미, 따뜻한 마무리까지. 목록·번호 금지, 단락만 나눠서."
}`
}

// ── 달이 채팅 페르소나 (이전 buildDariContext 의 정적 골격 + 클라가 보낸 데이터 값) ──
const DALI_TONE_MAP: Record<string, string> = {
  friend: '- 친근하게 편하게\n- 반말+존댓말 믹스, 이모지 자연스럽게',
  teacher: '- 조금 더 체계적이고 차분한 선생님 톤. 존댓말 위주.\n- "~해요", "~거예요" 등 부드러운 존댓말.\n- 가르쳐주되 권위적이지 않게, 격려하며 설명해.',
  grandma: '- 한국 할머니 말투. "~했구나", "~란다", "~하렴"\n- 따뜻하고 포근한 톤. 경험에서 우러나온 지혜.\n- "우리 손주" 느낌으로 다정하게.',
  poetic: '- 시적이고 서정적인 말투. 문학적 표현 사용.\n- 은유와 비유를 활용. "달빛이 속삭이듯", "꿈의 강물이 흐르는"\n- 짧고 아름다운 문장. 여운을 남기는 마무리.',
}

interface DaliParams {
  name?: string
  joinDays?: number
  streak?: number
  logsCount?: number
  greeting?: string
  period?: string
  tone?: string
  emotions?: string[]
  // 사용자 데이터 블록(클라이언트가 localStorage 에서 조립해 보냄 — IP 아님, 본인 데이터)
  historyBlock?: string   // 꿈 이력 요약
  memoryBlock?: string    // 달이가 기억하는 것
  crmBlock?: string       // CRM 맥락
  lastDreamBlock?: string // 방금 해몽한 꿈
}

function _daliSystem(p: DaliParams): string {
  const joinDays = typeof p.joinDays === 'number' ? p.joinDays : 0
  const name = _clip(p.name, 40) || '꿈탐험가'
  const period = p.period || ''
  const greeting = _clip(p.greeting, 80)
  const streak = typeof p.streak === 'number' ? p.streak : 0
  const logsCount = typeof p.logsCount === 'number' ? p.logsCount : 0
  const tone = (p.tone && DALI_TONE_MAP[p.tone]) ? p.tone : 'friend'
  const emotions = Array.isArray(p.emotions) && p.emotions.length > 0 ? p.emotions.map((e) => _clip(e, 20)).join(', ') : '미감지'

  // friend 톤은 친밀도(joinDays)에 따라 인사 강도 조절
  const friendTone = joinDays > 14 ? '- 오래된 친구처럼 편하게\n- 반말+존댓말 믹스, 이모지 자연스럽게'
    : joinDays > 3 ? '- 점점 친해지는 느낌으로\n- 반말+존댓말 믹스, 이모지 자연스럽게'
    : '- 첫 만남, 조심스럽고 따뜻하게\n- 반말+존댓말 믹스, 이모지 자연스럽게'
  const toneText = tone === 'friend' ? friendTone : DALI_TONE_MAP[tone]

  let context = `너는 "달이"야. 꿈 얘기 듣는 걸 좋아하는 친구.
${greeting} ${period === 'morning' ? '아침이니까 어젯밤 꿈 얘기 들을 준비됐어!' : period === 'night' ? '밤이니까 차분하게 얘기하자.' : ''}

너의 성격:
- 따뜻하고 호기심 많은 친구. 전문가 티 내지 마.
- 굵은 글씨(**) 절대 쓰지 마. 그냥 사람처럼 말해.
- 영어 쓰지 마. 학술 용어 쓰지 마. "원형", "무의식", "투영" 이런 말 대신 쉬운 말 써.
- 이모지는 문장 끝에 가끔만. 도배하지 마.
- 친구한테 카톡 보내듯이 편하게 말해.

꿈 얘기 들으면:
- 바로 해석해줘. "해몽 탭에서 해봐" 이런 말 절대 하지 마.
- 뱀꿈이라도 "물린 건지" "잡은 건지"에 따라 완전 다르게 해석해.
- 입력에 나온 인물의 성별·관계(전 여자친구·엄마·상사 등)는 절대 바꾸지 말고 그대로 써. 꿈에서 깬 뒤 느낀 감정(허전함·무서움 등)을 말하면 그걸 꼭 짚어줘.
- 그 사람이 요즘 뭘 고민하는지에 따라 해석이 달라져. 기억하고 있는 정보 활용해.
- 과거 꿈이랑 연결해서 패턴 알려줘.
- 해몽 후 [해몽: 제목|길몽 or 흉몽|핵심상징] 태그 붙여. (이건 시스템용이라 유저 눈에 안 보여)

꿈 얘기 아닐 때:
- 일상 대화도 OK. 근데 자연스럽게 꿈 얘기로 이어가봐.
- 꿈 기억하는 팁 알려줘도 좋아.
- 감정적이면 공감 먼저.
- 유저가 질문 → 꿈 코치
- 유저가 일상 → 맥락 연결자로 꿈과 이어줌
- 응답 끝에 [역할: interpret|pattern|coach|emotion|context] 태그
- 꿈 해몽했으면 [해몽: 제목|길몽/흉몽|핵심상징] 태그
- 새 정보 발견 시 [메모: 내용] 태그 (사실/감정/패턴/조언 자동 분류됨)
- 응답 끝에 [후속: 질문1|질문2|질문3] 태그

이 사람 정보:
- 이름: ${name}
- 함께한 지 ${joinDays}일째, 연속 ${streak}일 기록 중
- 꿈 기록 ${logsCount}개
`

  // 사용자 데이터 블록(클라가 보낸 본인 데이터) — 길이 제한 후 주입
  if (p.historyBlock) context += '\n' + _clip(p.historyBlock, 1500) + '\n'
  if (p.memoryBlock) context += '\n' + _clip(p.memoryBlock, 1500) + '\n'
  if (p.crmBlock) context += '\n' + _clip(p.crmBlock, 800) + '\n'
  if (p.lastDreamBlock) context += '\n' + _clip(p.lastDreamBlock, 300) + '\n'

  context += `
【현재 감정】 ${emotions}

【말투】
${toneText}
- 핵심 3-4문장, 절대 길게 늘어뜨리지 않기
- 꿈 데이터 인용 시 구체적 수치와 날짜 함께`

  return context
}

// ── 월간 리포트 내러티브 ──
interface MonthlyParams {
  count?: number
  good?: number
  bad?: number
  keywords?: string[]
  emotions?: string[]
  titles?: string[]
}

function _monthlySystem(): string {
  return '당신은 꿈 분석 전문가 달이입니다. 따뜻하고 탐색적인 톤으로 이야기합니다. 진단이 아닌 탐색적 표현만 사용합니다.'
}

function _monthlyUser(p: MonthlyParams): string {
  const count = typeof p.count === 'number' ? p.count : 0
  const good = typeof p.good === 'number' ? p.good : 0
  const bad = typeof p.bad === 'number' ? p.bad : 0
  const kws = Array.isArray(p.keywords) ? p.keywords.map((k) => _clip(k, 30)).join(', ') : ''
  const emos = Array.isArray(p.emotions) ? p.emotions.map((e) => _clip(e, 30)).join(', ') : ''
  const titles = Array.isArray(p.titles) ? p.titles.map((t) => _clip(t, 60)).join(', ') : ''
  return '당신은 따뜻한 꿈 분석가 달이입니다. 아래 데이터를 바탕으로 이번 달 꿈 리포트 내러티브를 3~5문장으로 작성하세요.\n'
    + '- 이번 달 꿈 수: ' + count + '개\n'
    + '- 길몽: ' + good + ', 흉몽: ' + bad + '\n'
    + '- 주요 키워드: ' + kws + '\n'
    + '- 주요 감정: ' + emos + '\n'
    + '- 최근 꿈 제목: ' + titles + '\n\n'
    + '톤: 탐색적이고 따뜻하게. 단정적 진단 금지. "~일 수 있어요" 어조 사용. 공포 마케팅 금지.'
}

// task 별 LLM payload(messages/model/options) 조립.
// 반환: OpenAI 호환 chat completion payload (서버 _callProvider 가 그대로 사용).
// 알 수 없는 task → null (호출부에서 400).
export function buildChatPayload(task: string, params: any): any | null {
  const p = params || {}
  switch (task) {
    case 'dream_quick': {
      const input = _clip(p.input, 4000)
      // repair=true → 직전 응답이 grounding 실패(입력 무시)했으므로 교정 지시를 덧붙여 재생성.
      const sys = _dreamQuickSystem(input, p.lifeStage) + (p.repair ? _groundingRepairDirective(input) : '')
      return {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: input },
        ],
        // [입력 grounding] 0.85 → 0.5: 해몽은 창의 변주보다 '사용자 입력 충실 반영'이 핵심 가치라
        //   높은 temperature 가 예시 패턴 변주/소재 환각을 부추겼다(입력"할머니/고래"→출력"아빠/고양이").
        temperature: p.repair ? 0.2 : 0.5,
        max_tokens: 700,
        response_format: { type: 'json_object' },
      }
    }
    case 'dream_detail': {
      const input = _clip(p.input, 4000)
      const sys = _dreamDetailSystem(input, p.lifeStage) + (p.repair ? _groundingRepairDirective(input) : '')
      return {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: input },
        ],
        temperature: p.repair ? 0.2 : 0.5,
        max_tokens: 3500,
        response_format: { type: 'json_object' },
      }
    }
    case 'dali_chat': {
      // history = 사용자/어시스턴트 turn 배열 (역할 검증 + 길이 제한)
      const rawHist = Array.isArray(p.history) ? p.history : []
      const history = rawHist
        .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-14)
        .map((m: any) => ({ role: m.role, content: _clip(m.content, 2000) }))
      return {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: _daliSystem(p) },
          ...history,
        ],
        max_tokens: 450,
        temperature: 0.85,
      }
    }
    case 'monthly_report': {
      return {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: _monthlySystem() },
          { role: 'user', content: _monthlyUser(p) },
        ],
        max_tokens: 300,
        temperature: 0.8,
      }
    }
    default:
      return null
  }
}
