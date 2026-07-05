// 러닝사진 (Routinist Photos) — 데이터 접근 레이어
// 2026-04-21 컨셉 피벗: opt-out 기본, 좋아요, 친구/동네 가중치 트렌딩

import { getSupabase } from './supabase';
import { fetchMyBlockedIds } from './message-data';

// build 290: 차단한 사용자의 사진을 모든 피드에서 제외 (Apple 1.2 — 차단 콘텐츠 숨김).
// lib 레벨 한 곳에서 걸러 PhotosTab/트렌딩/에세이 등 모든 화면이 자동 적용.
async function excludeBlocked<T extends { user_id: string }>(rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows;
  try {
    const blocked = await fetchMyBlockedIds();
    if (blocked.size === 0) return rows;
    return rows.filter(r => !blocked.has(r.user_id));
  } catch {
    return rows;
  }
}

export interface RoutinePhoto {
  photo_id: string;
  photo_url: string;
  caption: string | null;
  essay_body: string | null;       // 포토에세이 본문 (legacy, 메뉴에서 숨김 — build 106)
  quote_id: string | null;          // build 106: 공유카드 등록 시 선택된 명언 id
  quote_text: string | null;         // 명언 본문 (view join)
  quote_author: string | null;       // 명언 작성자
  contest_id: string | null;         // build 117: 친선런 연결
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  region_gu: string | null;
  gender: 'male' | 'female' | null;  // build 117
  show_gender: boolean;
  distance_km: number;
  activity_date: string;
  like_count: number;
  liked_by_me?: boolean;
  created_at: string;
  comment_count?: number;            // build 290: view 컬럼 — 카드별 count 쿼리 N+1 제거 (트렌딩 RPC 경로엔 없음)
}

// 메인 하단 캐러셀 — 최근 7일 × 친구×1.5 × 동네×1.3 가중치 트렌딩
// 5s timeout — 사용자 신고 #6/#8: 트렌딩 RPC 가 늦어 빈 카드가 오래 보이는 문제. 빈 배열 fallback.
export async function fetchTrendingPhotos(limit = 20): Promise<RoutinePhoto[]> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const rpcCall = supabase.rpc('routine_photos_trending', {
    viewer_id: user.id,
    limit_n: limit,
  });
  const result = await Promise.race<{ data: unknown; error: unknown } | { error: { message: string } }>([
    Promise.resolve(rpcCall) as Promise<{ data: unknown; error: unknown }>,
    new Promise<{ error: { message: string } }>((resolve) =>
      setTimeout(() => resolve({ error: { message: 'trending 5s timeout' } }), 5000)
    ),
  ]);
  let rows: RoutinePhoto[] = [];
  if ('data' in result && !result.error) {
    rows = await excludeBlocked((result.data ?? []) as RoutinePhoto[]);
  } else {
    console.warn('[routine_photos] trending 실패', result.error);
  }
  // build 293: 콜드스타트 backfill — 트렌딩(7일 윈도우)이 6장 미만이면 최신 사진으로 채움.
  // 초기 시장/해외 유저의 빈 캐러셀 방지. fetchRecentPhotos 는 excludeBlocked 이미 경유.
  if (rows.length >= 6) return rows;
  const recent = await fetchRecentPhotos({ limit });
  const seen = new Set(rows.map(p => p.photo_id));
  return [...rows, ...recent.filter(p => !seen.has(p.photo_id))].slice(0, limit);
}

interface PageOptions {
  limit?: number;
  offset?: number;
}

// 최신 순 (포토 탭 '최신')
export async function fetchRecentPhotos(opts: PageOptions = {}): Promise<RoutinePhoto[]> {
  const supabase = getSupabase();
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const { data, error } = await supabase
    .from('public_gallery_feed')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) { console.warn('[routine_photos] recent 실패', error); return []; }
  return excludeBlocked((data ?? []).map(mapRow));
}

// 친구만 (포토 탭 '친구')
export async function fetchFriendPhotos(friendIds: string[], opts: PageOptions = {}): Promise<RoutinePhoto[]> {
  if (friendIds.length === 0) return [];
  const supabase = getSupabase();
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const { data, error } = await supabase
    .from('public_gallery_feed')
    .select('*')
    .in('user_id', friendIds)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) { console.warn('[routine_photos] friends 실패', error); return []; }
  return excludeBlocked((data ?? []).map(mapRow));
}

// 내 구(區) (포토 탭 '동네')
export async function fetchRegionPhotos(regionGu: string, opts: PageOptions = {}): Promise<RoutinePhoto[]> {
  if (!regionGu) return [];
  const supabase = getSupabase();
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const { data, error } = await supabase
    .from('public_gallery_feed')
    .select('*')
    .eq('region_gu', regionGu)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) { console.warn('[routine_photos] region 실패', error); return []; }
  return excludeBlocked((data ?? []).map(mapRow));
}

// 내가 좋아요한 (포토 탭 '좋아요함')
export async function fetchMyLikedPhotos(opts: PageOptions = {}): Promise<RoutinePhoto[]> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  // RPC 가 offset 인자 미지원이면 limit 만 늘려 받고 JS 슬라이스 폴백.
  const { data, error } = await supabase.rpc('my_liked_photos', {
    viewer_id: user.id,
    limit_n: limit + offset,
  });
  if (error) { console.warn('[routine_photos] liked 실패', error); return []; }
  const rows = (data ?? []) as RoutinePhoto[];
  return offset > 0 ? rows.slice(offset) : rows;
}

// 본인이 등록한 러닝사진 삭제 (build 71). RLS 가 user_id = auth.uid() 일 때만 delete 허용.
// activity_photos 와 storage 객체 둘 다 삭제. storage 실패는 무시 (orphan 청소는 별도 cron).
export async function deleteMyPhoto(photoId: string, photoUrl: string): Promise<void> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다');

  const { error } = await supabase
    .from('activity_photos')
    .delete()
    .eq('id', photoId)
    .eq('user_id', user.id);
  if (error) throw error;

  // storage 정리 — public URL 에서 path 추출. 실패해도 삭제 자체는 성공.
  try {
    const u = new URL(photoUrl);
    const idx = u.pathname.indexOf('/activity-photos/');
    if (idx >= 0) {
      const path = u.pathname.slice(idx + '/activity-photos/'.length).split('?')[0];
      await supabase.storage.from('activity-photos').remove([decodeURIComponent(path)]);
    }
  } catch (e) {
    console.warn('[routine_photos] storage 정리 실패 (무시):', e);
  }
}

// 친선런과 사진 연결 (build 117)
export async function attachPhotoToContest(photoId: string, contestId: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('attach_photo_to_contest', {
    p_photo_id: photoId,
    p_contest_id: contestId,
  });
  if (error) throw error;
}

export interface ContestPhoto {
  photo_id: string;
  photo_url: string;
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  distance_km: number;
  created_at: string;
}

export async function fetchContestPhotos(contestId: string): Promise<ContestPhoto[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('fetch_contest_photos', { p_contest_id: contestId });
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    photo_id: r.photo_id as string,
    photo_url: r.photo_url as string,
    user_id: r.user_id as string,
    display_name: r.display_name as string,
    avatar_url: (r.avatar_url as string) ?? null,
    distance_km: Number(r.distance_km ?? 0),
    created_at: r.created_at as string,
  }));
}

// 본인의 같은 날짜 사진 list — contest 에 attach 할 후보 선택용
export async function fetchMyPhotosForDate(date: string): Promise<{ id: string; photo_url: string; created_at: string }[]> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from('activity_photos')
    .select('id, photo_url, created_at, activities!inner(activity_date)')
    .eq('user_id', user.id)
    .eq('activities.activity_date', date)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) return [];
  return (data ?? []).map((r: { id: string; photo_url: string; created_at: string }) => ({
    id: r.id, photo_url: r.photo_url, created_at: r.created_at,
  }));
}

// 사진 신고 (Apple 1.2 UGC 의무). 같은 사람이 같은 사진 여러번 신고는 unique 제약 없이 허용.
export async function reportPhoto(photoId: string, reason: 'inappropriate' | 'spam' | 'harassment' | 'other', detail?: string): Promise<void> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('로그인이 필요합니다');
  const { error } = await supabase.from('content_reports').insert({
    reporter_id: user.id,
    target_type: 'photo',
    target_id: photoId,
    reason,
    detail: detail ?? null,
  });
  if (error) throw error;
}

// 좋아요 토글 — optimistic update.
// 23505 (이미 like 됨) 은 idempotent 로 처리 (view 의 liked_by_me 가 stale 일 때 false positive 회피).
export async function togglePhotoLike(photoId: string, currentlyLiked: boolean): Promise<boolean> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('not authed');

  if (currentlyLiked) {
    const { error } = await supabase
      .from('photo_likes')
      .delete()
      .eq('photo_id', photoId)
      .eq('user_id', user.id);
    if (error) throw error;
    return false;
  } else {
    const { error } = await supabase
      .from('photo_likes')
      .insert({ photo_id: photoId, user_id: user.id });
    // unique violation = 이미 like 한 상태. UI 와 DB 가 어긋난 경우라 idempotent OK.
    if (error && (error as { code?: string }).code !== '23505') throw error;
    return true;
  }
}

// 내가 좋아요한 사진 ID 일괄 조회 (트렌딩 결과와 결합용)
export async function fetchMyLikedIds(): Promise<Set<string>> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Set();
  const { data, error } = await supabase
    .from('photo_likes')
    .select('photo_id')
    .eq('user_id', user.id);
  if (error) return new Set();
  return new Set((data ?? []).map((r: { photo_id: string }) => r.photo_id));
}

// view 행을 RoutinePhoto 로 변환 (뷰는 photo_id 대신 id 가 다르니 일치시킴)
function mapRow(row: Record<string, unknown>): RoutinePhoto {
  return {
    photo_id: (row.photo_id as string) ?? (row.id as string),
    photo_url: row.photo_url as string,
    caption: (row.caption as string) ?? null,
    essay_body: (row.essay_body as string) ?? null,
    quote_id: (row.quote_id as string) ?? null,
    quote_text: (row.quote_text as string) ?? null,
    quote_author: (row.quote_author as string) ?? null,
    contest_id: (row.contest_id as string) ?? null,
    user_id: row.user_id as string,
    display_name: row.display_name as string,
    avatar_url: (row.avatar_url as string) ?? null,
    region_gu: (row.region_gu as string) ?? null,
    gender: (row.gender as 'male' | 'female') ?? null,
    show_gender: row.show_gender !== false,
    distance_km: Number(row.distance_km ?? 0),
    activity_date: row.activity_date as string,
    like_count: Number(row.like_count ?? 0),
    liked_by_me: row.liked_by_me === true,
    created_at: row.created_at as string,
  };
}

// 포토에세이 작성/수정 (사용자 피드백 #10)
export async function updatePhotoEssay(photoId: string, essay: string): Promise<boolean> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('update_photo_essay', {
    p_photo_id: photoId,
    p_essay: essay,
  });
  if (error) throw error;
  return !!data;
}

// 에세이가 있는 포토만 list (긴 글 전용 피드)
export async function fetchEssayFeed(opts: PageOptions = {}): Promise<RoutinePhoto[]> {
  const supabase = getSupabase();
  const limit = opts.limit ?? 30;
  const offset = opts.offset ?? 0;
  const { data, error } = await supabase
    .from('public_gallery_feed')
    .select('*')
    .not('essay_body', 'is', null)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) { console.warn('[essay feed] fail', error); return []; }
  return excludeBlocked((data ?? []).map(mapRow));
}

// 단일 photo (essay 단독 페이지용)
export async function fetchPhotoById(photoId: string): Promise<RoutinePhoto | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('public_gallery_feed')
    .select('*')
    .eq('photo_id', photoId)
    .maybeSingle();
  if (error || !data) return null;
  return mapRow(data as Record<string, unknown>);
}

// 페이지에서 받은 사진 목록에 liked_by_me 를 일괄 적용 (view 에 컬럼 없을 때 fallback).
export async function applyLikedFlags<T extends { photo_id: string; liked_by_me?: boolean }>(
  photos: T[],
): Promise<T[]> {
  if (photos.length === 0) return photos;
  const likedIds = await fetchMyLikedIds();
  return photos.map(p => ({ ...p, liked_by_me: likedIds.has(p.photo_id) }));
}
