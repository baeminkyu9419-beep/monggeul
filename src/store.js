// 몽글몽글 — 공유 상태 저장소
export const store = {
  supabase: null,
  currentUser: null,
  xp: parseInt(localStorage.getItem('mg_xp')||'0'),
  streak: parseInt(localStorage.getItem('mg_streak')||'0'),
  lastCin: localStorage.getItem('mg_cin')||'',
  selectedEmotions: [],
  selectedContexts: [],
  chatHist: JSON.parse(localStorage.getItem('mg_chat_hist')||'[]'),
  dariGreeted: false,
};
