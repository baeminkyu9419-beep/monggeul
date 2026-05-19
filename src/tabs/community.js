// 몽글몽글 — 커뮤니티 탭 (Supabase Realtime + 로컬 폴백)
import { showToast } from '../components/toast.js';
import { drawDetailRadar } from '../components/radar.js';
import { FEED_DEMO, STICKERS } from '../utils/symbols.js';
import { generateDailyPosts } from '../services/community-bot.js';
import { addXP, addXPSilent } from './my.js';
import { esc } from '../utils/sanitize.js';
import {
  fetchPosts, fetchPopularPosts, createPost, toggleLikePost,
  fetchComments, createComment, addStickerReaction,
  subscribeToPosts, unsubscribePosts, saveBotPost, getTodayBotPostCount,
} from '../services/community-storage.js';

let currentFilter = '전체';
let likedPosts = new Set();
let currentDetailId = null;
let detailCommentsCache = {};
let stickerCounts = {};
let currentAnon = 'anon';
const anonHints = { anon: '누구도 내가 쓴 글인지 알 수 없어요', nickname: '오늘의 랜덤 별명으로 공개돼요', profile: '내 레벨과 배지가 함께 보여요' };
let currentWriteType = '꿈기록';

// ═══ 피드 데이터 캐시 ═══
let cachedFeed = [];
let feedFromLocal = true;
let realtimeActive = false;

// ═══ 초기화: 봇 포스트 생성 + DB 저장 + Realtime 구독 ═══
export async function initCommunity() {
  // 봇 일일 포스트 DB 저장 시도
  const botCount = await getTodayBotPostCount();
  if (botCount === 0) {
    const botPosts = generateDailyPosts();
    for (const post of botPosts) {
      await saveBotPost(post);
    }
  }

  // Realtime 구독
  subscribeToPosts(
    (newPost) => {
      // 새 게시물 실시간 추가
      if (!cachedFeed.find(p => p.id === newPost.id)) {
        cachedFeed.unshift(newPost);
        if (document.querySelector('.community-tab.active, [data-tab="community"].active')) {
          renderFeed();
        }
      }
    },
    (updated) => {
      // 좋아요/댓글 수 실시간 반영
      if (updated._commentAdded) {
        // 댓글 추가 이벤트
        if (currentDetailId === updated.post_id) {
          loadAndRenderComments(updated.post_id);
        }
        return;
      }
      const idx = cachedFeed.findIndex(p => p.id === updated.id);
      if (idx >= 0) {
        cachedFeed[idx] = { ...cachedFeed[idx], ...updated };
        renderFeed();
      }
    }
  );
  realtimeActive = true;

  // 초기 피드 로드
  await loadFeed();
}

async function loadFeed() {
  let result;
  if (currentFilter === '인기') {
    result = await fetchPopularPosts(30);
  } else {
    result = await fetchPosts({ filter: currentFilter, limit: 30 });
  }
  cachedFeed = result.data;
  feedFromLocal = result.fromLocal;

  // Supabase에 데이터가 없으면 로컬 데모 데이터를 시딩용으로 병합
  if (!feedFromLocal && cachedFeed.length === 0) {
    cachedFeed = FEED_DEMO.map(f => ({
      ...f, _local: true,
      like_count: f.likes || 0,
      comment_count: (f.comments || []).length,
    }));
    feedFromLocal = true;
  }
}

function findPost(id) {
  return cachedFeed.find(x => x.id === id || x.id === String(id));
}

// ═══ 피드 렌더링 ═══

export function setAnon(type, btn) {
  currentAnon = type;
  document.querySelectorAll('.anon-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  const hint = document.getElementById('anonHint');
  if (hint) hint.textContent = anonHints[type];
}

export function renderFeed() {
  const bm = { 길몽: 'bl', 태몽: 'bl', 재물운: 'bl', 활력: 'bl', 흉몽: 'bb', 연애운: 'bv', 건강운: 'bv' };
  let filtered = cachedFeed;

  if (currentFilter !== '전체' && currentFilter !== '인기') {
    filtered = cachedFeed.filter(f => f.tag === currentFilter);
  }

  const el = document.getElementById('feedList');
  if (!filtered.length) {
    el.innerHTML = '<div class="empty"><div class="empty-icon">🌙</div><div class="empty-txt">아직 이 카테고리에 꿈이 없어요.<br>첫 번째로 공유해볼까요?</div></div>';
    return;
  }

  el.innerHTML = filtered.map(f => {
    const postId = f.id;
    const likes = f.like_count ?? f.likes ?? 0;
    const commentCnt = f.comment_count ?? (f.comments || []).length;
    const nick = f.nick || '꿈탐험가';
    const icon = f.icon || '🌙';
    const av = f.avatar || f.av || 'a1';
    const time = f._local ? (f.time || formatTimeAgo(f.created_at)) : formatTimeAgo(f.created_at);
    const badges = f.badges || [];
    const isLiked = likedPosts.has(postId);
    const displayLikes = isLiked && f._local ? likes + 1 : likes;

    return `
    <div class="feed-card" onclick="openDetail('${postId}')">
      <div class="fc-top">
        <div class="fc-av ${av}">${esc(icon)}</div>
        <div><div class="fc-nm">${esc(nick)}</div><div class="fc-tm">${esc(time)}</div></div>
        <div class="fc-badges">${badges.map(b => `<span class="badge ${bm[b] || 'bl'}" style="font-size:10px;padding:2px 8px">${esc(b)}</span>`).join('')}</div>
      </div>
      <div class="fc-title">${esc(f.title)}</div>
      <div class="fc-body">${esc(f.body)}</div>
      <div class="fc-bot">
        <div class="fc-reactions">
          <button class="rbtn ${isLiked ? 'on' : ''}" onclick="event.stopPropagation();toggleLike('${postId}',this)">🌟 ${displayLikes}</button>
          <button class="rbtn" onclick="event.stopPropagation();openDetail('${postId}')">💬 ${commentCnt}</button>
        </div>
        ${f.similar ? `<div class="fc-similar-cnt" style="font-size:10px;color:var(--purple-bright)">🔍 나도 비슷 · ${parseInt(String(f.similar).match(/\d+/)?.[0] || '0')}명</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

// ═══ 상세 페이지 ═══

export async function openDetail(id) {
  const f = findPost(id);
  if (!f) return;
  currentDetailId = id;

  const bm = { 길몽: 'bl', 태몽: 'bl', 재물운: 'bl', 활력: 'bl', 흉몽: 'bb', 연애운: 'bv', 건강운: 'bv' };
  const av = f.avatar || f.av || 'a1';
  const nick = f.nick || '꿈탐험가';
  const icon = f.icon || '🌙';
  const time = f._local ? (f.time || formatTimeAgo(f.created_at)) : formatTimeAgo(f.created_at);
  const badges = f.badges || [];

  const dAv = document.getElementById('dAv');
  dAv.className = `detail-author-av fc-av ${av}`; dAv.textContent = icon;
  document.getElementById('dNick').textContent = nick;
  document.getElementById('dTime').textContent = time;
  document.getElementById('dBadges').innerHTML = badges.map(b => `<span class="badge ${bm[b] || 'bl'}" style="font-size:10px;padding:2px 8px">${b}</span>`).join('');
  document.getElementById('dTitle').textContent = f.title;
  document.getElementById('dBody').textContent = f.body;

  const likes = f.like_count ?? f.likes ?? 0;
  const liked = likedPosts.has(id);
  const likeCount = liked && f._local ? likes + 1 : likes;
  document.getElementById('dLikeBtn').className = 'detail-like-btn' + (liked ? ' on' : '');
  document.getElementById('dLikeCount').textContent = likeCount;
  document.getElementById('dLikesText').textContent = `${likeCount}명이 공감했어요`;

  drawDetailRadar(f.stats);
  await loadAndRenderComments(id);

  document.getElementById('detailPage').classList.add('on');
  document.body.style.overflow = 'hidden';
}

async function loadAndRenderComments(postId) {
  const f = findPost(postId);
  if (!f) return;

  let comments = [];

  if (f._local) {
    // 로컬 데모 데이터: 내장 댓글 + 사용자 추가 댓글
    comments = [...(detailCommentsCache[postId] || []), ...(f.comments || [])];
  } else {
    // Supabase에서 댓글 로드
    const result = await fetchComments(postId);
    if (!result.fromLocal) {
      comments = result.data.map(c => ({
        icon: c.icon || '🌙',
        nick: c.nick || '꿈탐험가',
        text: c.body,
        time: formatTimeAgo(c.created_at),
        _id: c.id,
      }));
    }
    // 로컬 추가 댓글도 병합
    comments = [...(detailCommentsCache[postId] || []), ...comments];
  }

  document.getElementById('dCommentCount').textContent = comments.length + '개';
  document.getElementById('commentList').innerHTML = comments.map((c, ci) => `
    <div class="comment-item">
      <div class="comment-av">${c.icon || '🌙'}</div>
      <div class="comment-body">
        <div class="comment-nick">${esc(c.nick)}</div>
        <div class="comment-text">${esc(c.text)}</div>
        <div class="comment-meta">
          <span class="comment-time">${esc(c.time)}</span>
        </div>
        <div class="sticker-row">
          ${STICKERS.map(s => {
            const k = postId + '_' + ci + '_' + s.key;
            const cnt = stickerCounts[k] || 0;
            return `<button class="sticker-btn${cnt ? ' on' : ''}" data-key="${s.key}" data-post="${postId}" data-ci="${ci}" onclick="addSticker('${postId}',${ci},'${s.key}',this)">${s.label}${cnt ? ' ' + cnt : ''}</button>`;
          }).join('')}
        </div>
      </div>
    </div>`).join('');
}

export function closeDetail() {
  document.getElementById('detailPage').classList.remove('on');
  document.body.style.overflow = '';
  currentDetailId = null;
}

// ═══ 좋아요/댓글/스티커 ═══

export async function postComment() {
  const inp = document.getElementById('commentInput');
  const txt = inp.value.trim();
  if (!txt || !currentDetailId) return;
  inp.value = '';

  const f = findPost(currentDetailId);
  if (!f) return;

  if (f._local) {
    // 로컬 폴백
    if (!detailCommentsCache[currentDetailId]) detailCommentsCache[currentDetailId] = [];
    detailCommentsCache[currentDetailId].unshift({ icon: '🐱', nick: '나', text: txt, time: '방금' });
    await loadAndRenderComments(currentDetailId);
  } else {
    // Supabase 댓글 저장
    const result = await createComment(currentDetailId, txt);
    if (result.fromLocal) {
      if (!detailCommentsCache[currentDetailId]) detailCommentsCache[currentDetailId] = [];
      detailCommentsCache[currentDetailId].unshift({ icon: '🐱', nick: '나', text: txt, time: '방금' });
    }
    await loadAndRenderComments(currentDetailId);
  }

  addXP(5);
  showToast('댓글을 남겼어요 💬 +5 XP');
  renderFeed();
}

export async function toggleDetailLike() {
  if (!currentDetailId) return;
  const f = findPost(currentDetailId);
  if (!f) return;

  if (f._local) {
    // 로컬 토글
    if (likedPosts.has(currentDetailId)) likedPosts.delete(currentDetailId);
    else { likedPosts.add(currentDetailId); addXP(2); }
  } else {
    // Supabase 좋아요 토글
    const result = await toggleLikePost(currentDetailId);
    if (result.fromLocal) {
      if (likedPosts.has(currentDetailId)) likedPosts.delete(currentDetailId);
      else likedPosts.add(currentDetailId);
    } else {
      if (result.liked) { likedPosts.add(currentDetailId); addXP(2); }
      else likedPosts.delete(currentDetailId);
      // 서버에서 최신 카운트 반영 (Realtime이 처리)
    }
  }

  const likes = f.like_count ?? f.likes ?? 0;
  const liked = likedPosts.has(currentDetailId);
  const cnt = liked && f._local ? likes + 1 : likes;
  document.getElementById('dLikeBtn').className = 'detail-like-btn' + (liked ? ' on' : '');
  document.getElementById('dLikeCount').textContent = cnt;
  document.getElementById('dLikesText').textContent = `${cnt}명이 공감했어요`;
  renderFeed();
}

export function clickSimilar() { showToast('비슷한 꿈 모음 기능 준비 중이에요 🔍'); }
export function closeDetailDirect() { closeDetail(); }

export async function toggleLike(id, btn) {
  const f = findPost(id);
  if (!f) return;

  if (f._local) {
    if (likedPosts.has(id)) likedPosts.delete(id);
    else {
      likedPosts.add(id);
      if (btn) sparkEffect(btn);
    }
  } else {
    const result = await toggleLikePost(id);
    if (result.fromLocal) {
      if (likedPosts.has(id)) likedPosts.delete(id);
      else likedPosts.add(id);
    } else {
      if (result.liked) { likedPosts.add(id); if (btn) sparkEffect(btn); }
      else likedPosts.delete(id);
    }
  }
  renderFeed();
}

function sparkEffect(btn) {
  const heart = document.createElement('span');
  heart.textContent = '🌟';
  heart.style.cssText = 'position:absolute;font-size:20px;pointer-events:none;animation:sparkPop .6s ease-out forwards;z-index:50;';
  btn.style.position = 'relative';
  btn.appendChild(heart);
  setTimeout(() => heart.remove(), 700);
}

// ═══ 필터 ═══

export async function setFilter(f) {
  currentFilter = f;
  document.querySelectorAll('.ftab').forEach(b => {
    b.classList.toggle('on', b.textContent.includes(f) || (f === '전체' && b.textContent.includes('전체')));
  });
  await loadFeed();
  renderFeed();
}

export async function setCommunityFilter(f) {
  currentFilter = f;
  document.querySelectorAll('#communityFilterRow .ftab').forEach(b => {
    b.classList.toggle('on', b.textContent.includes(f === '전체' ? '전체' : f));
  });
  await loadFeed();
  renderFeed();
}

// ═══ 글쓰기 ═══

export function shareToFeed() {
  if (!window._last) { showToast('먼저 해몽을 해보세요 🔮'); return; }
  showToast('커뮤니티에 공유됐어요! +15 XP ✨'); addXP(15);
  const btn = document.querySelector('.mrc-share-btn');
  if (btn) { btn.textContent = '공유됨 ✓'; btn.style.background = '#3a8a4e'; }
}

export function openWriteSheet(type = '꿈기록') {
  currentWriteType = type;
  document.querySelectorAll('.wtype-btn').forEach(b => b.classList.remove('on'));
  document.querySelectorAll('.wtype-btn').forEach(b => { if (b.textContent.includes(type === '꿈기록' ? '꿈' : type === '질문' ? '해몽' : type)) b.classList.add('on'); });
  const titles = { 꿈기록: '🌙 꿈 기록하기', 질문: '🔮 해몽 질문하기', 일상: '💭 일상 공유하기' };
  document.getElementById('writeSheetTitle').textContent = titles[type] || '글쓰기';
  const rdi = document.getElementById('recentDreamImport');
  if (rdi) rdi.style.display = type === '꿈기록' ? 'block' : 'none';
  if (type === '꿈기록' && window._last) {
    const el = document.getElementById('recentDreamTitle');
    const sub = document.getElementById('recentDreamSub');
    if (el) el.textContent = window._last.data.title;
    if (sub) sub.textContent = '탭해서 내용 가져오기';
  }
  const ws = document.getElementById('writeSheet');
  ws.style.display = 'flex';
  requestAnimationFrame(() => ws.classList.add('on'));
}

export function closeWriteSheet() {
  const ws = document.getElementById('writeSheet');
  ws.classList.remove('on');
  setTimeout(() => { if (!ws.classList.contains('on')) ws.style.display = 'none'; }, 320);
}

export function setWriteType(type, btn) {
  currentWriteType = type;
  document.querySelectorAll('.wtype-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  const rdi = document.getElementById('recentDreamImport');
  if (rdi) rdi.style.display = type === '꿈기록' ? 'block' : 'none';
}

export function toggleWriteTag(el) { el.classList.toggle('on'); }

export function importRecentDream() {
  if (!window._last) return;
  const ta = document.getElementById('writeInput');
  ta.value = window._last.inp + '\n\n' + window._last.data.preview.replace(/<[^>]+>/g, '');
  showToast('최근 해몽을 가져왔어요 🌙');
}

export async function submitPost() {
  const txt = document.getElementById('writeInput').value.trim();
  if (!txt) { showToast('내용을 입력해주세요'); return; }

  const tag = currentWriteType === '꿈기록' ? '꿈기록' : currentWriteType === '질문' ? '질문' : '일상';
  const badges = [currentWriteType === '꿈기록' ? '길몽' : '일상'];

  await createPost({
    title: '🌙 ' + txt.substring(0, 20),
    body: txt.substring(0, 500),
    tag,
    badges,
    stats: {},
    postType: currentWriteType,
    anonMode: currentAnon,
  });

  closeWriteSheet();
  document.getElementById('writeInput').value = '';
  showToast('커뮤니티에 공유됐어요! ✨ +15 XP');
  addXP(15);

  // 피드 새로고침
  await loadFeed();
  window.switchTab('community');
  renderFeed();
}

// ═══ 스티커 ═══

export async function addSticker(postId, commentIdx, key, btn) {
  const k = postId + '_' + commentIdx + '_' + key;
  if (stickerCounts[k]) return;
  stickerCounts[k] = 1;
  btn.classList.add('on');
  const label = STICKERS.find(s => s.key === key)?.label || '';
  btn.textContent = label + ' 1';
  addXPSilent(1);

  // Supabase 저장 시도
  const f = findPost(postId);
  if (f && !f._local) {
    await addStickerReaction(postId, null, key);
  }
}

// ═══ 기타 ═══

export function updateCommunityTab() {
  if (window._last && document.getElementById('recentDreamTitle')) {
    document.getElementById('recentDreamTitle').textContent = window._last.data.title;
    document.getElementById('recentDreamSub').textContent = '탭해서 내용 가져오기';
  }
}

export function adoptComment() {}

// "나와 비슷한 꿈" 매칭 (Phase 2-3)
export function renderSimilarDreamsSection() {
  const el = document.getElementById('similarDreamsSection');
  if (!el) return;

  const logs = JSON.parse(localStorage.getItem('mg_logs') || '[]');
  if (logs.length === 0) { el.style.display = 'none'; return; }

  const myKws = new Set();
  logs.slice(0, 5).forEach(function (l) {
    (l.badges || []).forEach(function (b) { myKws.add(b); });
    (l.text || '').split(/\s+/).forEach(function (w) { if (w.length >= 2) myKws.add(w); });
  });

  const scored = cachedFeed.map(function (post) {
    var score = 0;
    myKws.forEach(function (k) {
      if (post.body && post.body.includes(k)) score += 2;
      if (post.tag && post.tag.includes(k)) score += 3;
      if (post.title && post.title.includes(k)) score += 1;
    });
    return { post: post, score: score };
  }).filter(function (s) { return s.score > 0; }).sort(function (a, b) { return b.score - a.score; }).slice(0, 3);

  if (scored.length === 0) { el.style.display = 'none'; return; }

  var e = function (s) { return String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  el.innerHTML = '<div style="font-size:13px;font-weight:700;color:var(--purple-bright);margin-bottom:10px;display:flex;align-items:center;gap:6px"><span>🔗</span>나와 비슷한 꿈</div>'
    + scored.map(function (s) {
      var p = s.post;
      return '<div style="background:rgba(166,124,239,.05);border:1px solid rgba(166,124,239,.12);border-radius:12px;padding:10px;margin-bottom:6px;cursor:pointer" onclick="goToStoryTag(\'' + e(p.tag || '') + '\')"><div style="display:flex;justify-content:space-between;align-items:center"><div style="font-size:12px;font-weight:600;color:var(--moon)">' + e(p.title || '') + '</div><span class="badge bl" style="font-size:8px;padding:1px 5px">' + e(p.tag || '') + '</span></div><div style="font-size:10px;color:var(--text-secondary);margin-top:4px;line-height:1.5">' + e((p.body || '').substring(0, 60)) + '...</div><div style="font-size:9px;color:var(--text-muted);margin-top:4px">유사도 ' + Math.min(s.score * 10, 95) + '%</div></div>';
    }).join('');
  el.style.display = 'block';
}

// ═══ 유틸 ═══

function formatTimeAgo(dateStr) {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '방금 전';
  if (mins < 60) return mins + '분 전';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + '시간 전';
  const days = Math.floor(hours / 24);
  if (days < 7) return days + '일 전';
  return new Date(dateStr).toLocaleDateString('ko-KR');
}

// ═══ 클린업 ═══
export function destroyCommunity() {
  unsubscribePosts();
  realtimeActive = false;
}

// ═══ window 노출 ═══
window.renderFeed = renderFeed;
window.openDetail = openDetail;
window.closeDetail = closeDetail;
window.postComment = postComment;
window.toggleDetailLike = toggleDetailLike;
window.clickSimilar = clickSimilar;
window.closeDetailDirect = closeDetailDirect;
window.setFilter = setFilter;
window.toggleLike = toggleLike;
window.shareToFeed = shareToFeed;
window.openWriteSheet = openWriteSheet;
window.closeWriteSheet = closeWriteSheet;
window.setWriteType = setWriteType;
window.toggleWriteTag = toggleWriteTag;
window.importRecentDream = importRecentDream;
window.submitPost = submitPost;
window.setCommunityFilter = setCommunityFilter;
window.updateCommunityTab = updateCommunityTab;
window.renderComments = loadAndRenderComments;
window.adoptComment = adoptComment;
window.addSticker = addSticker;
window.setAnon = setAnon;
window.initCommunity = initCommunity;
