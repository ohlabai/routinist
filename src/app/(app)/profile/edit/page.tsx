'use client';

import { useState, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { uploadAvatar } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Camera, MapPin } from 'lucide-react';
import Link from 'next/link';
import AppLogo from '@/components/AppLogo';
import { COUNTRIES, KR_REGIONS, KR_SIDO_LIST } from '@/lib/regions';
import { detectRegion } from '@/lib/geo';
import ImageCropModal from '@/components/ImageCropModal';

const CURRENT_YEAR = new Date().getFullYear();
const BIRTH_YEARS = Array.from({ length: 80 }, (_, i) => CURRENT_YEAR - 14 - i);

export default function ProfileEditPage() {
  const { user, profile, refreshProfile } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');

  const [country, setCountry] = useState<string>(profile?.country_code || 'KR');
  const [sido, setSido] = useState<string>(profile?.region_si ?? '');
  const [gu, setGu] = useState(profile?.region_gu ?? '');

  const [birthYear, setBirthYear] = useState<string>(profile?.birth_year?.toString() ?? '');
  const [gender, setGender] = useState<string>(profile?.gender ?? '');
  const [runningSince, setRunningSince] = useState<string>(profile?.running_since ?? '');

  const [avatarPreview, setAvatarPreview] = useState(profile?.avatar_url ?? '');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [detecting, setDetecting] = useState(false);

  const isKorea = country === 'KR';
  const guList = isKorea && sido ? KR_REGIONS[sido] ?? [] : [];

  // 사용자 피드백 #2: 동그라미 안에 어떻게 들어갈지 미리 보여줘야 함.
  // 파일 선택 → CropModal → 원형 mask 안에서 zoom/drag 후 확정 → 파일 저장.
  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCropSrc(URL.createObjectURL(file));
    // input 초기화 — 같은 파일 재선택 가능
    if (e.target) e.target.value = '';
  };

  const handleCropDone = (blob: Blob) => {
    const cropped = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
    setAvatarFile(cropped);
    setAvatarPreview(URL.createObjectURL(blob));
    setCropSrc(null);
  };

  const handleDetectRegion = async () => {
    setDetecting(true);
    setMessage('');
    try {
      const r = await detectRegion();
      setCountry(r.country_code);
      if (r.country_code === 'KR') {
        if (r.si) setSido(r.si);
        if (r.gu) setGu(r.gu);
      }
      setMessage(`현재 위치: ${r.display}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '위치 감지 실패');
    } finally {
      setDetecting(false);
    }
  };

  const handleSave = async () => {
    if (!user || !displayName.trim()) return;
    setSaving(true);
    setMessage('');

    // 진단 로그용 — "저장 중" 무한 멈춤 디버깅
    const { logClientInfo, logClientWarn, logClientError } = await import('@/lib/error-logger');
    const t0 = Date.now();
    logClientInfo('profile-edit', 'save start', { hasAvatar: !!avatarFile });

    const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
      Promise.race<T>([
        p,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`${label} ${ms / 1000}s timeout`)), ms)
        ),
      ]);

    try {
      let avatarUrl = profile?.avatar_url ?? null;
      if (avatarFile) {
        // avatar 업로드 race — 이전엔 보호 없어서 무한 hang 가능했음 (사용자 신고: "저장 중" 멈춤)
        try {
          const t1 = Date.now();
          avatarUrl = await withTimeout(uploadAvatar(user.id, avatarFile), 20000, 'uploadAvatar');
          logClientInfo('profile-edit', 'avatar upload ok', { ms: Date.now() - t1 });
        } catch (e) {
          logClientWarn('profile-edit', 'avatar upload 실패 — 텍스트만 저장 시도', {
            err: e instanceof Error ? e.message : String(e),
          });
          // 아바타 실패해도 다른 필드는 저장. 사용자에게는 부분 성공 안내.
          avatarUrl = profile?.avatar_url ?? null;
        }
      }

      const { getSupabase } = await import('@/lib/supabase');
      const updatePromise = getSupabase()
        .from('profiles')
        .update({
          display_name: displayName.trim(),
          avatar_url: avatarUrl,
          bio: bio.trim() || null,
          country_code: country || null,
          region_si: isKorea ? (sido || null) : (COUNTRIES.find(c => c.code === country)?.native ?? null),
          region_gu: isKorea ? (gu || null) : null,
          birth_year: birthYear ? parseInt(birthYear, 10) : null,
          gender: gender || null,
          running_since: runningSince || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      const result = await Promise.race([
        updatePromise,
        new Promise<{ error: { message: string } }>((resolve) =>
          setTimeout(() => resolve({ error: { message: '저장 요청 15초 초과 — 네트워크 확인 후 다시 시도해주세요' } }), 15000)
        ),
      ]);

      if (result.error) throw result.error;
      logClientInfo('profile-edit', 'update ok', { totalMs: Date.now() - t0 });

      // refreshProfile 도 hang 가능성 (loadProfile → getProfile 쿼리). 8s race + 실패해도 저장은 성공으로 처리.
      try {
        await withTimeout(refreshProfile(), 8000, 'refreshProfile');
      } catch (e) {
        logClientWarn('profile-edit', 'refreshProfile 실패 — 저장은 완료', {
          err: e instanceof Error ? e.message : String(e),
        });
      }
      setMessage('저장되었습니다!');
      setTimeout(() => router.back(), 800);
    } catch (e) {
      const msg = e instanceof Error
        ? e.message
        : (e && typeof e === 'object' && 'message' in e)
          ? String((e as { message: unknown }).message)
          : String(e);
      logClientError('profile-edit', 'save 실패', { err: msg, totalMs: Date.now() - t0 });
      setMessage(`저장 실패: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-6 pb-32">
      {cropSrc && (
        <ImageCropModal
          src={cropSrc}
          onCancel={() => setCropSrc(null)}
          onCropped={handleCropDone}
        />
      )}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/profile" className="text-[var(--muted)]">
          <ArrowLeft size={24} />
        </Link>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">프로필 편집</h1>
      </div>

      <div className="flex justify-center mb-6">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="relative w-24 h-24 rounded-full bg-[var(--card-border)] overflow-hidden"
        >
          {avatarPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarPreview} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center"><AppLogo size={48} /></div>
          )}
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
            <Camera size={24} className="text-white" />
          </div>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleAvatarChange}
          className="hidden"
        />
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[var(--foreground)] mb-1">닉네임</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={20}
            className="w-full px-4 py-3 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
          <p className="text-xs text-[var(--muted)] mt-1">{displayName.length}/20</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-[var(--foreground)] mb-1">소개</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={100}
            rows={3}
            placeholder="한 줄 소개를 입력해주세요"
            className="w-full px-4 py-3 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
          />
          <p className="text-xs text-[var(--muted)] mt-1">{bio.length}/100</p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-[var(--foreground)]">지역</label>
            <button
              onClick={handleDetectRegion}
              disabled={detecting}
              className="flex items-center gap-1 text-xs text-[var(--accent)] font-medium disabled:opacity-50"
            >
              <MapPin size={14} />
              {detecting ? '감지 중...' : '현재 위치로 자동 선택'}
            </button>
          </div>

          <div>
            <p className="text-xs text-[var(--muted)] mb-1">국가</p>
            <select
              value={country}
              onChange={(e) => {
                setCountry(e.target.value);
                setSido('');
                setGu('');
              }}
              className="w-full px-4 py-3 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
            >
              {COUNTRIES.map(c => (
                <option key={c.code} value={c.code}>{c.native}</option>
              ))}
            </select>
          </div>

          <div>
            <p className="text-xs text-[var(--muted)] mb-1">시/도</p>
            <select
              value={sido}
              onChange={(e) => {
                setSido(e.target.value);
                setGu('');
              }}
              disabled={!isKorea}
              className="w-full px-4 py-3 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-50"
            >
              <option value="">선택 안함</option>
              {KR_SIDO_LIST.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div>
            <p className="text-xs text-[var(--muted)] mb-1">구/군</p>
            <select
              value={gu}
              onChange={(e) => setGu(e.target.value)}
              disabled={!isKorea || !sido}
              className="w-full px-4 py-3 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-50"
            >
              <option value="">선택 안함</option>
              {guList.map(g => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 추가 프로필 — 매칭 랭킹에 사용. 모두 선택 항목. */}
        <div className="border-t border-[var(--card-border)] pt-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-[var(--foreground)] mb-1">
              랭킹 매칭 정보 <span className="text-xs text-[var(--muted)]">(선택)</span>
            </label>
            <p className="text-xs text-[var(--muted)] mb-3">
              비슷한 조건의 러너와 나를 비교해서 재미있는 순위를 보여드려요. 언제든 수정·삭제 가능합니다.
            </p>
          </div>

          <div>
            <p className="text-xs text-[var(--muted)] mb-1">출생 연도</p>
            <select
              value={birthYear}
              onChange={(e) => setBirthYear(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)] text-sm"
            >
              <option value="">선택 안함</option>
              {BIRTH_YEARS.map(y => (
                <option key={y} value={y}>{y}년</option>
              ))}
            </select>
          </div>

          <div>
            <p className="text-xs text-[var(--muted)] mb-1">성별</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { v: 'male', label: '남성' },
                { v: 'female', label: '여성' },
                { v: 'other', label: '기타' },
              ].map(opt => (
                <button
                  key={opt.v}
                  onClick={() => setGender(gender === opt.v ? '' : opt.v)}
                  type="button"
                  className={`py-2.5 rounded-xl text-sm font-medium border transition-colors ${
                    gender === opt.v
                      ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                      : 'bg-[var(--card)] text-[var(--foreground)] border-[var(--card-border)]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs text-[var(--muted)] mb-1">러닝 시작 시점</p>
            <input
              type="month"
              value={runningSince ? runningSince.slice(0, 7) : ''}
              onChange={(e) => setRunningSince(e.target.value ? `${e.target.value}-01` : '')}
              className="w-full px-4 py-3 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)] text-sm"
            />
          </div>
        </div>
      </div>

      <div className="fixed bottom-16 left-0 right-0 px-4 py-3 bg-[var(--background)]/95 backdrop-blur-xl border-t border-[var(--card-border)] pb-[calc(env(safe-area-inset-bottom)+12px)]">
        <div className="max-w-lg mx-auto">
          <button
            onClick={handleSave}
            disabled={saving || !displayName.trim()}
            className="w-full py-3.5 rounded-xl bg-[var(--accent)] text-white font-semibold text-base disabled:opacity-50 shadow-lg"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
          {message && (
            <p className={`text-center text-sm mt-2 ${message.includes('오류') || message.includes('실패') || message.includes('거부') ? 'text-red-500' : 'text-green-500'}`}>
              {message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
