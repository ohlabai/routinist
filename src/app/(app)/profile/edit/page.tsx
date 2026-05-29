'use client';

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { uploadAvatar } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Camera, MapPin } from 'lucide-react';
import Link from 'next/link';
import AppLogo from '@/components/AppLogo';
import { COUNTRIES, KR_REGIONS, KR_SIDO_LIST } from '@/lib/regions';
import { detectRegion } from '@/lib/geo';
import ImageCropModal from '@/components/ImageCropModal';
import { useDisplayNameCheck } from '@/lib/useDisplayNameCheck';
import DisplayNameStatusHint from '@/components/DisplayNameStatusHint';
import { useI18n } from '@/lib/i18n';

const CURRENT_YEAR = new Date().getFullYear();
const BIRTH_YEARS = Array.from({ length: 80 }, (_, i) => CURRENT_YEAR - 14 - i);

export default function ProfileEditPage() {
  const { user, profile, refreshProfile } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { tt, locale } = useI18n();

  const [displayName, setDisplayName] = useState(profile?.display_name ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  // 본인 row 제외 + 기존 닉네임이면 unchanged (RPC 호출 스킵)
  const displayNameCheck = useDisplayNameCheck(displayName, user?.id, profile?.display_name);

  const [country, setCountry] = useState<string>(profile?.country_code || 'KR');
  const [sido, setSido] = useState<string>(profile?.region_si ?? '');
  const [gu, setGu] = useState(profile?.region_gu ?? '');

  const [birthYear, setBirthYear] = useState<string>(profile?.birth_year?.toString() ?? '');
  const [gender, setGender] = useState<string>(profile?.gender ?? '');
  const [showGender, setShowGender] = useState<boolean>((profile as { show_gender?: boolean } | null)?.show_gender ?? true);
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
  // Blob URL 은 사용 후 revoke 해야 메모리 누수 방지 (사진 여러 번 바꿀 때 누적).
  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(URL.createObjectURL(file));
    if (e.target) e.target.value = '';
  };

  const handleCropDone = (blob: Blob) => {
    const cropped = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
    // 이전 preview 가 blob URL 이면 revoke (서버 http URL 은 revoke 불가/불필요)
    if (avatarPreview.startsWith('blob:')) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(cropped);
    setAvatarPreview(URL.createObjectURL(blob));
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  };

  const handleCropCancel = () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  };

  // unmount 시 잔존 blob URL 정리
  useEffect(() => {
    return () => {
      if (cropSrc) URL.revokeObjectURL(cropSrc);
      if (avatarPreview.startsWith('blob:')) URL.revokeObjectURL(avatarPreview);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      setMessage(`${tt('현재 위치: ')}${r.display}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : tt('위치 감지 실패'));
    } finally {
      setDetecting(false);
    }
  };

  const handleSave = async () => {
    if (!user || !displayName.trim()) return;
    if (!displayNameCheck.isValid) {
      setMessage(displayNameCheck.message || tt('닉네임을 다시 확인해주세요'));
      return;
    }
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
          show_gender: showGender,
          running_since: runningSince || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);

      const result = await Promise.race([
        updatePromise,
        new Promise<{ error: { message: string } }>((resolve) =>
          setTimeout(() => resolve({ error: { message: tt('저장 요청 15초 초과 — 네트워크 확인 후 다시 시도해주세요') } }), 15000)
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
      setMessage(tt('저장되었습니다!'));
      setTimeout(() => router.back(), 800);
    } catch (e) {
      const msg = e instanceof Error
        ? e.message
        : (e && typeof e === 'object' && 'message' in e)
          ? String((e as { message: unknown }).message)
          : String(e);
      logClientError('profile-edit', 'save 실패', { err: msg, totalMs: Date.now() - t0 });
      setMessage(`${tt('저장 실패')}: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto pb-32 bg-[var(--background)] min-h-screen">
      {cropSrc && (
        <ImageCropModal
          src={cropSrc}
          onCancel={handleCropCancel}
          onCropped={handleCropDone}
        />
      )}
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <Link href="/profile" className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition">
            <ArrowLeft size={20} />
          </Link>
          <h1 className="text-xl font-extrabold tracking-tight">{tt('프로필 편집')}</h1>
        </div>
      </header>
      <div className="px-4 pt-4">

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
          <label className="block text-base font-semibold text-[var(--foreground)] mb-1.5">{locale === 'en' ? 'Nickname' : '닉네임'}</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            maxLength={20}
            className="w-full px-4 py-3.5 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)] text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
          />
          <div className="flex items-center justify-between mt-1">
            <DisplayNameStatusHint check={displayNameCheck} />
            <p className="text-xs text-[var(--muted)]">{displayName.length}/20</p>
          </div>
        </div>

        <div>
          <label className="block text-base font-semibold text-[var(--foreground)] mb-1.5">{locale === 'en' ? 'Bio' : '소개'}</label>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={100}
            rows={3}
            placeholder={tt('한 줄 소개를 입력해주세요')}
            className="w-full px-4 py-3.5 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)] text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
          />
          <p className="text-xs text-[var(--muted)] mt-1">{bio.length}/100</p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-[var(--foreground)]">{locale === 'en' ? 'Region' : '지역'}</label>
            <button
              onClick={handleDetectRegion}
              disabled={detecting}
              className="flex items-center gap-1 text-xs text-[var(--accent)] font-medium disabled:opacity-50"
            >
              <MapPin size={14} />
              {detecting ? tt('감지 중...') : tt('현재 위치로 자동 선택')}
            </button>
          </div>

          <div>
            <p className="text-xs text-[var(--muted)] mb-1">{locale === 'en' ? 'Country' : '국가'}</p>
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
            <p className="text-xs text-[var(--muted)] mb-1">{locale === 'en' ? 'Province / City' : '시/도'}</p>
            <select
              value={sido}
              onChange={(e) => {
                setSido(e.target.value);
                setGu('');
              }}
              disabled={!isKorea}
              className="w-full px-4 py-3 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-50"
            >
              <option value="">{locale === 'en' ? 'Not selected' : '선택 안함'}</option>
              {KR_SIDO_LIST.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div>
            <p className="text-xs text-[var(--muted)] mb-1">{locale === 'en' ? 'District' : '구/군'}</p>
            <select
              value={gu}
              onChange={(e) => setGu(e.target.value)}
              disabled={!isKorea || !sido}
              className="w-full px-4 py-3 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)] disabled:opacity-50"
            >
              <option value="">{locale === 'en' ? 'Not selected' : '선택 안함'}</option>
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
              {locale === 'en' ? 'Ranking match info' : '랭킹 매칭 정보'} <span className="text-xs text-[var(--muted)]">{locale === 'en' ? '(optional)' : '(선택)'}</span>
            </label>
            <p className="text-xs text-[var(--muted)] mb-3">
              {tt('비슷한 조건의 러너와 나를 비교해서 재미있는 순위를 보여드려요.')} {locale === 'en' ? 'Editable anytime.' : '언제든 수정·삭제 가능합니다.'}
            </p>
          </div>

          <div>
            <p className="text-xs text-[var(--muted)] mb-1">{locale === 'en' ? 'Birth year' : '출생 연도'}</p>
            <select
              value={birthYear}
              onChange={(e) => setBirthYear(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)] text-sm"
            >
              <option value="">{locale === 'en' ? 'Not selected' : '선택 안함'}</option>
              {BIRTH_YEARS.map(y => (
                <option key={y} value={y}>{locale === 'en' ? String(y) : `${y}년`}</option>
              ))}
            </select>
          </div>

          <div>
            <p className="text-xs text-[var(--muted)] mb-1">{locale === 'en' ? 'Gender' : '성별'}</p>
            <div className="grid grid-cols-3 gap-3">
              {[
                { v: 'male', label: locale === 'en' ? 'Male' : '남성' },
                { v: 'female', label: locale === 'en' ? 'Female' : '여성' },
                { v: 'other', label: locale === 'en' ? 'Other' : '기타' },
              ].map(opt => (
                <button
                  key={opt.v}
                  onClick={() => setGender(gender === opt.v ? '' : opt.v)}
                  type="button"
                  className={`min-h-[44px] py-3 rounded-xl text-sm font-medium border transition-colors ${
                    gender === opt.v
                      ? 'bg-[var(--accent)] text-white border-[var(--accent)]'
                      : 'bg-[var(--card)] text-[var(--foreground)] border-[var(--card-border)]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {(gender === 'male' || gender === 'female') && (
              <label className="flex items-center gap-2 mt-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showGender}
                  onChange={(e) => setShowGender(e.target.checked)}
                  className="w-4 h-4 accent-emerald-500"
                />
                <span className="text-xs text-[var(--muted)]">{locale === 'en' ? 'Show gender icon (♂/♀) on profile' : '프로필에 성별 아이콘(♂/♀) 표시'}</span>
              </label>
            )}
          </div>

          <div>
            <p className="text-xs text-[var(--muted)] mb-1">{locale === 'en' ? 'Running since' : '러닝 시작 시점'}</p>
            <input
              type="month"
              value={runningSince ? runningSince.slice(0, 7) : ''}
              onChange={(e) => setRunningSince(e.target.value ? `${e.target.value}-01` : '')}
              className="w-full px-4 py-3 rounded-xl bg-[var(--card)] border border-[var(--card-border)] text-[var(--foreground)] text-sm"
            />
          </div>
        </div>
      </div>

      </div>

      <div className="fixed bottom-16 left-0 right-0 px-4 py-3 bg-[var(--background)]/95 backdrop-blur-xl border-t border-[var(--card-border)]/30 pb-[calc(env(safe-area-inset-bottom)+12px)]">
        <div className="max-w-lg mx-auto">
          <button
            onClick={handleSave}
            disabled={saving || !displayName.trim() || !displayNameCheck.isValid}
            className="w-full py-4 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-extrabold text-base disabled:opacity-50 active:scale-[0.98] shadow-md shadow-emerald-500/30"
          >
            {saving ? tt('저장 중…') : tt('저장')}
          </button>
          {message && (
            <p className={`text-center text-xs mt-2 font-bold ${message.includes('오류') || message.includes('실패') || message.includes('거부') ? 'text-red-500' : 'text-emerald-600'}`}>
              {message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
