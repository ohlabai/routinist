'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { updateProfile, uploadAvatar } from '@/lib/auth';
import { useEffect } from 'react';
import { useDisplayNameCheck } from '@/lib/useDisplayNameCheck';
import DisplayNameStatusHint from '@/components/DisplayNameStatusHint';

export default function SignupPage() {
  const router = useRouter();
  const { user, profile, loading, refreshProfile } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // OAuth 가입 직후엔 profile 이 '러너' 기본값으로 자동 생성됨 → 본인 row 제외 위해 user.id 전달
  const displayNameCheck = useDisplayNameCheck(displayName, user?.id);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
    // 이미 프로필이 완성된 경우
    if (!loading && profile && profile.display_name !== '러너') {
      router.replace('/dashboard');
    }
  }, [user, profile, loading, router]);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name === '러너' ? '' : profile.display_name);
    }
  }, [profile]);

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = () => setAvatarPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !displayName.trim()) return;
    if (!displayNameCheck.isValid) {
      setError(displayNameCheck.message || '닉네임을 다시 확인해주세요');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      let avatarUrl: string | undefined;

      if (avatarFile) {
        avatarUrl = await uploadAvatar(user.id, avatarFile);
      }

      await updateProfile(user.id, {
        display_name: displayName.trim(),
        ...(avatarUrl && { avatar_url: avatarUrl }),
      });

      await refreshProfile();
      router.replace('/dashboard');
    } catch (e) {
      setError(e instanceof Error ? e.message : '프로필 저장 중 오류가 발생했습니다.');
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <div className="animate-spin w-8 h-8 border-3 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--background)] px-6">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold text-[var(--foreground)]">프로필 설정</h1>
        <p className="text-xs text-[var(--muted)] mt-2">닉네임과 프로필 사진을 설정해주세요</p>
      </div>

      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-6">
        {/* 아바타 */}
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="relative w-24 h-24 rounded-full bg-[var(--card-border)] overflow-hidden hover:opacity-80 transition-opacity"
          >
            {avatarPreview ? (
              <img src={avatarPreview} alt="프로필" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[var(--muted)]">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </div>
            )}
            <div className="absolute bottom-0 right-0 w-7 h-7 bg-[var(--accent)] rounded-full flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
            </div>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleAvatarSelect}
            className="hidden"
          />
        </div>

        {/* 닉네임 */}
        <div>
          <label className="block text-sm font-medium text-[var(--foreground)] mb-2">
            닉네임
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="달리기를 좋아하는 러너"
            maxLength={20}
            className="w-full px-4 py-3 rounded-xl border border-[var(--card-border)] bg-[var(--background)] text-[var(--foreground)] text-base focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent"
          />
          <div className="flex items-center justify-between mt-1">
            <DisplayNameStatusHint check={displayNameCheck} />
            <p className="text-xs text-[var(--muted)]">{displayName.length}/20</p>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-500 text-center">{error}</p>
        )}

        <button
          type="submit"
          disabled={saving || !displayName.trim() || !displayNameCheck.isValid}
          className="w-full bg-[var(--accent)] hover:opacity-90 text-white font-semibold py-3.5 rounded-xl transition-all text-base disabled:opacity-50"
        >
          {saving ? '저장 중...' : '시작하기'}
        </button>
      </form>
    </div>
  );
}
