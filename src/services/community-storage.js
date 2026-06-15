// 몽글몽글 — 커뮤니티 Supabase Storage + Realtime
import { store } from '../store.js';
import { logEvent } from './analytics.js';
import { FEED_DEMO } from '../utils/symbols.js';

// ═══ 로컬 폴백 데이터 (Supabase 미연결 시) ═══
let localPosts = null;
function getLocalFallback() {
  if (!localPosts) {
    localPosts = FEED_DEMO.map(f => ({
      ...f,
      _local: true,
      like_count: f.likes || 0,
      comment_count: (f.comments || []).length,
    }));
  }
  return localPosts;
}

function isOnline() {
  return store.supabase && navigator.onLine;
}

// ═══ 게시물 CRUD ═══

export async function fetchPosts({ filter = '전체', limit = 30, offset = 0 } = {}) {
  if (!isOnline()) return { data: filterLocal(filter), fromLocal: true };

  try {
    let query = store.supabase
      .from('community_posts')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (filter !== '전체' && filter !== '인기') {
      query = query.eq('tag', filter);
    }

    const { data, error } = await query;
    if (error) throw error;

    return { data: data || [], fromLocal: false };
  } catch (e) {
    return { data: filterLocal(filter), fromLocal: true };
  }
}

export async function fetchPopularPosts(limit = 20) {
  if (!isOnline()) {
    return { data: [...getLocalFallback()].sort((a, b) => b.like_count - a.like_count).slice(0, limit), fromLocal: true };
  }

  try {
    const { data, error } = await store.supabase.rpc('get_popular_posts', { p_limit: limit });
    if (error) throw error;
    return { data: data || [], fromLocal: false };
  } catch (e) {
    return { data: [...getLocalFallback()].sort((a, b) => b.like_count - a.like_count).slice(0, limit), fromLocal: true };
  }
}

export async function createPost({ title, body, tag, badges, stats, postType, anonMode }) {
  const user = store.currentUser;
  const nick = localStorage.getItem('mg_nickname') || '꿈탐험가';

  if (!isOnline() || !user) {
    // 로컬 폴백: 메모리에만 추가
    const local = {
      id: 'local_' + Date.now(),
      _local: true,
      nick,
      icon: '🐱',
      avatar: 'a1',
      post_type: postType || '꿈기록',
      title,
      body,
      tag: tag || null,
      badges: badges || [],
      stats: stats || {},
      like_count: 0,
      comment_count: 0,
      created_at: new Date().toISOString(),
    };
    getLocalFallback().unshift(local);
    return { data: local, fromLocal: true };
  }

  try {
    const { data, error } = await store.supabase
      .from('community_posts')
      .insert({
        user_id: user.id,
        nick,
        icon: '🌙',
        avatar: 'a1',
        post_type: postType || '꿈기록',
        title,
        body,
        tag: tag || null,
        badges: badges || [],
        stats: stats || {},
        anon_mode: anonMode || 'anon',
      })
      .select()
      .single();

    if (error) throw error;
    logEvent('community_post_created', { post_type: postType, tag });
    return { data, fromLocal: false };
  } catch (e) {
    const local = {
      id: 'local_' + Date.now(), _local: true, nick, icon: '🌙',
      title, body, tag, badges: badges || [], stats: stats || {},
      like_count: 0, comment_count: 0, created_at: new Date().toISOString(),
    };
    getLocalFallback().unshift(local);
    return { data: local, fromLocal: true };
  }
}

// ═══ 좋아요 토글 ═══

export async function toggleLikePost(postId) {
  const user = store.currentUser;
  if (!isOnline() || !user) return { liked: false, fromLocal: true };

  try {
    // [보안 수정 2026-06-15] p_user_id 제거 — 서버가 auth.uid() 로 결정(IDOR 차단)
    const { data, error } = await store.supabase.rpc('toggle_post_like', {
      p_post_id: postId,
    });
    if (error) throw error;
    logEvent('community_like_toggled', { post_id: postId, liked: data });
    return { liked: data, fromLocal: false };
  } catch (e) {
    return { liked: false, fromLocal: true };
  }
}

// ═══ 댓글 ═══

export async function fetchComments(postId) {
  if (!isOnline()) return { data: [], fromLocal: true };

  try {
    const { data, error } = await store.supabase
      .from('community_comments')
      .select('*')
      .eq('post_id', postId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return { data: data || [], fromLocal: false };
  } catch (e) {
    return { data: [], fromLocal: true };
  }
}

export async function createComment(postId, body) {
  const user = store.currentUser;
  const nick = localStorage.getItem('mg_nickname') || '꿈탐험가';

  const _localToast = '인터넷 연결 없이 임시 저장됐어요 — 다음에 연결되면 공유되지 않아요';

  if (!isOnline() || !user) {
    return { data: { id: 'local_' + Date.now(), nick, icon: '🐱', body, created_at: new Date().toISOString() }, fromLocal: true, localToast: _localToast };
  }

  try {
    const { data, error } = await store.supabase
      .from('community_comments')
      .insert({ post_id: postId, user_id: user.id, nick, icon: '🌙', body })
      .select()
      .single();

    if (error) throw error;
    logEvent('community_comment_created', { post_id: postId });
    return { data, fromLocal: false };
  } catch (e) {
    return { data: { id: 'local_' + Date.now(), nick, icon: '🐱', body, created_at: new Date().toISOString() }, fromLocal: true, localToast: _localToast };
  }
}

// ═══ 스티커 리액션 ═══

export async function addStickerReaction(postId, commentId, reactionType) {
  const user = store.currentUser;
  if (!isOnline() || !user) return { fromLocal: true };

  try {
    const { error } = await store.supabase
      .from('community_reactions')
      .insert({
        post_id: postId,
        comment_id: commentId || null,
        user_id: user.id,
        reaction_type: reactionType,
      });

    if (error && error.code === '23505') return { duplicate: true }; // unique violation
    if (error) throw error;
    return { fromLocal: false };
  } catch (e) {
    return { fromLocal: true };
  }
}

// ═══ Supabase Realtime 구독 ═══

let realtimeChannel = null;

export function subscribeToPosts(onInsert, onUpdate) {
  if (!isOnline()) return;

  try {
    realtimeChannel = store.supabase
      .channel('community-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'community_posts' }, payload => {
        if (onInsert) onInsert(payload.new);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'community_posts' }, payload => {
        if (onUpdate) onUpdate(payload.new);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'community_comments' }, payload => {
        if (onUpdate) onUpdate({ _commentAdded: true, post_id: payload.new.post_id, comment: payload.new });
      })
      .subscribe();
  } catch (e) {
    // Realtime 실패해도 앱은 정상 동작
  }
}

export function unsubscribePosts() {
  if (realtimeChannel) {
    store.supabase?.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

// ═══ 봇 포스트 DB 저장 ═══

export async function saveBotPost(post) {
  if (!isOnline()) return { fromLocal: true };

  try {
    const { data, error } = await store.supabase
      .from('community_posts')
      .insert({
        user_id: null,
        nick: post.nick,
        icon: post.icon,
        avatar: post.av || 'a1',
        post_type: 'bot',
        title: post.title,
        body: post.body,
        tag: post.tag || null,
        badges: post.badges || [],
        stats: post.stats || {},
        similar: post.similar || null,
        like_count: post.likes || 0,
      })
      .select()
      .single();

    if (error) throw error;
    return { data, fromLocal: false };
  } catch (e) {
    return { fromLocal: true };
  }
}

export async function getTodayBotPostCount() {
  if (!isOnline()) return 0;

  try {
    const today = new Date().toISOString().split('T')[0];
    const { count, error } = await store.supabase
      .from('community_posts')
      .select('*', { count: 'exact', head: true })
      .eq('post_type', 'bot')
      .gte('created_at', today + 'T00:00:00Z');

    if (error) throw error;
    return count || 0;
  } catch (e) {
    return 0;
  }
}

// ═══ 유틸 ═══

function filterLocal(filter) {
  const feed = getLocalFallback();
  if (filter === '전체') return feed;
  if (filter === '인기') return [...feed].sort((a, b) => b.like_count - a.like_count);
  return feed.filter(f => f.tag === filter);
}
