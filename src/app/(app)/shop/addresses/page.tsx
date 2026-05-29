'use client';

// 배송지 관리 — 모던 모바일 UX/UI (에메랄드 그린).

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, MapPin, Plus, Edit2, Trash2, Star, Home } from 'lucide-react';
import {
  fetchAddresses, createAddress, updateAddress, deleteAddress, formatPhoneKR,
  type NewAddressInput,
} from '@/lib/shop-data';
import { useAuth } from '@/components/AuthProvider';
import AppToast from '@/components/AppToast';
import AddressAutocompleteSheet from '@/components/shop/AddressAutocompleteSheet';
import { useI18n } from '@/lib/i18n';
import type { ShippingAddress } from '@/types';

const EMPTY_ADDR: NewAddressInput = {
  recipient_name: '', phone: '', postal_code: '', address_line1: '',
  address_line2: '', is_default: false, label: '집',
};

export default function AddressesPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { tt, locale } = useI18n();
  const [list, setList] = useState<ShippingAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<NewAddressInput>(EMPTY_ADDR);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);
  const [postcodeOpen, setPostcodeOpen] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    fetchAddresses()
      .then(setList)
      .catch(e => console.warn('[addresses] load fail', e))
      .finally(() => setLoading(false));
  }, [authLoading, user, router]);

  const showToast = (text: string, tone: 'ok' | 'warn' = 'ok') => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 2500);
  };

  const startEdit = (addr: ShippingAddress) => {
    setForm({
      recipient_name: addr.recipient_name,
      phone: addr.phone,
      postal_code: addr.postal_code,
      address_line1: addr.address_line1,
      address_line2: addr.address_line2 ?? '',
      is_default: addr.is_default,
      label: addr.label ?? '',
    });
    setEditing(addr.id);
  };

  const startNew = () => {
    setForm({ ...EMPTY_ADDR, is_default: list.length === 0 });
    setEditing('new');
  };

  const cancelEdit = () => {
    setEditing(null);
    setForm(EMPTY_ADDR);
  };

  const handleSave = async () => {
    if (!form.recipient_name.trim() || !form.phone.trim() || !form.postal_code.trim() || !form.address_line1.trim()) {
      showToast(tt('필수 항목을 모두 입력해주세요'), 'warn');
      return;
    }
    setSubmitting(true);
    try {
      if (editing === 'new') {
        const created = await createAddress(form);
        setList(prev => {
          const updated = form.is_default ? prev.map(a => ({ ...a, is_default: false })) : prev;
          return [created, ...updated];
        });
        showToast(tt('새 배송지 추가 완료'));
      } else if (editing) {
        await updateAddress(editing, form);
        setList(prev => prev.map(a => {
          if (a.id === editing) return { ...a, ...form } as ShippingAddress;
          if (form.is_default) return { ...a, is_default: false };
          return a;
        }));
        showToast(tt('수정 완료'));
      }
      cancelEdit();
    } catch (e) {
      showToast(e instanceof Error ? e.message : tt('저장 실패'), 'warn');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await updateAddress(id, { is_default: true });
      setList(prev => prev.map(a => ({ ...a, is_default: a.id === id })));
      showToast(locale === 'en' ? 'Set as default' : '기본 배송지로 지정했어요');
    } catch (e) {
      showToast(e instanceof Error ? e.message : tt('실패'), 'warn');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(tt('이 배송지를 삭제하시겠어요?'))) return;
    try {
      await deleteAddress(id);
      setList(prev => prev.filter(a => a.id !== id));
      showToast(tt('삭제 완료'));
    } catch (e) {
      showToast(e instanceof Error ? e.message : tt('삭제 실패'), 'warn');
    }
  };

  if (loading || authLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto pb-12 bg-[var(--background)] min-h-screen">
      <header className="sticky top-0 z-30 bg-[var(--background)]/80 backdrop-blur-lg border-b border-[var(--card-border)]/30">
        <div className="flex items-center gap-2 px-3 py-3">
          <button onClick={() => router.back()} className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-90 transition">
            <ArrowLeft size={20} />
          </button>
          <h1 className="text-xl font-extrabold tracking-tight flex-1">{tt('배송지 관리')}</h1>
          {!editing && (
            <button
              onClick={startNew}
              className="text-xs font-bold text-emerald-600 inline-flex items-center gap-1 active:scale-95 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/30"
            >
              <Plus size={14} /> {locale === 'en' ? 'Add' : '추가'}
            </button>
          )}
        </div>
      </header>

      {/* 폼 (편집/추가) */}
      {editing && (
        <div className="px-4 mt-4">
          <div className="card p-5 space-y-3 border-2 border-emerald-200 dark:border-emerald-900/40">
            <p className="text-sm font-extrabold inline-flex items-center gap-1.5">
              {editing === 'new'
                ? <><Plus size={14} className="text-emerald-500" /> {locale === 'en' ? 'New address' : '새 배송지'}</>
                : <><Edit2 size={14} className="text-emerald-500" /> {locale === 'en' ? 'Edit address' : '배송지 수정'}</>}
            </p>
            <Input placeholder={locale === 'en' ? 'Label (Home, Office, ...)' : '별칭 (집, 회사 등)'} value={form.label ?? ''} onChange={v => setForm({ ...form, label: v })} />
            <Input placeholder={tt('받는 사람 이름 *')} value={form.recipient_name} onChange={v => setForm({ ...form, recipient_name: v })} />
            <Input type="tel" inputMode="numeric" placeholder={locale === 'en' ? 'Phone (010-1234-5678) *' : '연락처 (010-1234-5678) *'} value={form.phone} onChange={v => setForm({ ...form, phone: formatPhoneKR(v) })} />
            <button
              type="button"
              onClick={() => setPostcodeOpen(true)}
              className={`w-full px-3.5 py-3 rounded-2xl border-2 border-[var(--card-border)] bg-[var(--background)] text-sm text-left ${form.postal_code ? 'text-[var(--foreground)] font-semibold' : 'text-[var(--muted)]'}`}
            >
              {form.postal_code || (locale === 'en' ? 'Zip * (tap to search)' : '우편번호 * (탭하여 검색)')}
            </button>
            <Input placeholder={locale === 'en' ? 'Street address *' : '기본 주소 *'} value={form.address_line1} readOnly onClick={() => setPostcodeOpen(true)} />
            <Input placeholder={locale === 'en' ? 'Apt / Suite (optional)' : '상세 주소 (선택)'} value={form.address_line2 ?? ''} onChange={v => setForm({ ...form, address_line2: v })} />
            <label className="flex items-center gap-2.5 mt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_default}
                onChange={e => setForm({ ...form, is_default: e.target.checked })}
                className="w-5 h-5 rounded accent-emerald-500"
              />
              <span className="text-sm text-[var(--foreground)] inline-flex items-center gap-1">
                <Star size={12} className={form.is_default ? 'text-emerald-500 fill-emerald-500' : 'text-[var(--muted)]'} />
                {locale === 'en' ? 'Set as default' : '기본 배송지로 설정'}
              </span>
            </label>
            <div className="flex gap-2 pt-2">
              <button
                onClick={cancelEdit}
                className="flex-1 py-3 rounded-2xl border border-[var(--card-border)] text-sm font-bold text-[var(--muted)] active:scale-[0.98]"
              >
                {locale === 'en' ? 'Cancel' : '취소'}
              </button>
              <button
                onClick={handleSave}
                disabled={submitting}
                className="flex-1 py-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white text-sm font-extrabold active:scale-[0.98] disabled:opacity-50 shadow-md shadow-emerald-500/25"
              >
                {submitting ? (locale === 'en' ? 'Saving…' : '저장 중…') : tt('저장')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 목록 */}
      {list.length === 0 && !editing ? (
        <div className="text-center py-24 px-6">
          <div className="w-24 h-24 rounded-full bg-emerald-50 dark:bg-emerald-950/30 mx-auto mb-5 flex items-center justify-center">
            <MapPin size={42} className="text-emerald-500" />
          </div>
          <p className="text-lg font-extrabold mb-1.5">{tt('등록된 배송지가 없어요')}</p>
          <p className="text-sm text-[var(--muted)] mb-7">{locale === 'en' ? 'Add your first shipping address' : '첫 배송지를 추가해 주세요'}</p>
          <button
            onClick={startNew}
            className="inline-flex items-center gap-1.5 px-6 py-3 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white font-bold shadow-md shadow-emerald-500/30 active:scale-95"
          >
            <Plus size={16} /> {locale === 'en' ? 'Add first address' : '첫 배송지 추가'}
          </button>
        </div>
      ) : (
        <div className="px-4 mt-4 space-y-2.5">
          {list.map(a => (
            <div
              key={a.id}
              className={`card p-4 ${a.is_default ? 'border-2 border-emerald-200 dark:border-emerald-900/40 bg-gradient-to-br from-emerald-50/30 to-transparent dark:from-emerald-950/10' : ''}`}
            >
              <div className="flex items-start justify-between mb-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-extrabold">{a.recipient_name}</p>
                  {a.label && (
                    <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 inline-flex items-center gap-1">
                      <Home size={10} /> {a.label}
                    </span>
                  )}
                  {a.is_default && (
                    <span className="text-[10px] font-extrabold text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full bg-emerald-500 text-white inline-flex items-center gap-1">
                      <Star size={10} fill="currentColor" /> {locale === 'en' ? 'Default' : '기본'}
                    </span>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-[var(--muted)] mb-1">{a.phone}</p>
              <p className="text-xs text-[var(--foreground)] leading-relaxed">
                [{a.postal_code}] {a.address_line1} {a.address_line2 ?? ''}
              </p>
              <div className="flex gap-1 mt-3 pt-3 border-t border-[var(--card-border)]/40">
                {!a.is_default && (
                  <button
                    onClick={() => handleSetDefault(a.id)}
                    className="flex-1 py-2 rounded-xl text-[11px] font-bold text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-95"
                  >
                    {locale === 'en' ? 'Set default' : '기본 지정'}
                  </button>
                )}
                <button
                  onClick={() => startEdit(a)}
                  className="flex-1 py-2 rounded-xl text-[11px] font-bold text-[var(--muted)] hover:bg-[var(--card)] active:scale-95 inline-flex items-center justify-center gap-1"
                >
                  <Edit2 size={11} /> {locale === 'en' ? 'Edit' : '수정'}
                </button>
                <button
                  onClick={() => handleDelete(a.id)}
                  className="flex-1 py-2 rounded-xl text-[11px] font-bold text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 active:scale-95 inline-flex items-center justify-center gap-1"
                >
                  <Trash2 size={11} /> {locale === 'en' ? 'Delete' : '삭제'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2500} />}
      {postcodeOpen && (
        <AddressAutocompleteSheet
          onClose={() => setPostcodeOpen(false)}
          onComplete={(r) => {
            setForm(prev => ({
              ...prev,
              postal_code: r.zonecode,
              address_line1: r.address,
            }));
            setPostcodeOpen(false);
          }}
        />
      )}
    </div>
  );
}

function Input({
  placeholder, value, onChange, type = 'text', inputMode, readOnly, onClick,
}: {
  placeholder: string;
  value: string;
  onChange?: (v: string) => void;
  type?: string;
  inputMode?: 'numeric' | 'text';
  readOnly?: boolean;
  onClick?: () => void;
}) {
  return (
    <input
      type={type}
      inputMode={inputMode}
      placeholder={placeholder}
      value={value}
      readOnly={readOnly}
      onClick={onClick}
      onChange={onChange ? e => onChange(e.target.value) : undefined}
      className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--background)] border-2 border-[var(--card-border)] text-sm font-medium focus:outline-none focus:border-emerald-500 transition placeholder:text-[var(--muted)]"
    />
  );
}
