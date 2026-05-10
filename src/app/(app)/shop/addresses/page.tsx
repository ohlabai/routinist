'use client';

// 배송지 관리 — 추가 / 수정 / 기본 지정 / 삭제.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, MapPin, Plus, Edit2, Trash2, Star } from 'lucide-react';
import {
  fetchAddresses, createAddress, updateAddress, deleteAddress,
  type NewAddressInput,
} from '@/lib/shop-data';
import { useAuth } from '@/components/AuthProvider';
import AppToast from '@/components/AppToast';
import type { ShippingAddress } from '@/types';

const EMPTY_ADDR: NewAddressInput = {
  recipient_name: '', phone: '', postal_code: '', address_line1: '',
  address_line2: '', is_default: false, label: '집',
};

export default function AddressesPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [list, setList] = useState<ShippingAddress[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<NewAddressInput>(EMPTY_ADDR);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'ok' | 'warn' } | null>(null);

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
      showToast('필수 항목을 모두 입력해주세요', 'warn');
      return;
    }
    setSubmitting(true);
    try {
      if (editing === 'new') {
        const created = await createAddress(form);
        setList(prev => {
          const updated = form.is_default
            ? prev.map(a => ({ ...a, is_default: false }))
            : prev;
          return [created, ...updated];
        });
        showToast('새 배송지 추가 완료');
      } else if (editing) {
        await updateAddress(editing, form);
        setList(prev => prev.map(a => {
          if (a.id === editing) return { ...a, ...form } as ShippingAddress;
          if (form.is_default) return { ...a, is_default: false };
          return a;
        }));
        showToast('수정 완료');
      }
      cancelEdit();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '저장 실패', 'warn');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await updateAddress(id, { is_default: true });
      setList(prev => prev.map(a => ({ ...a, is_default: a.id === id })));
      showToast('기본 배송지로 지정했어요');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '실패', 'warn');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('이 배송지를 삭제하시겠어요?')) return;
    try {
      await deleteAddress(id);
      setList(prev => prev.filter(a => a.id !== id));
      showToast('삭제 완료');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '삭제 실패', 'warn');
    }
  };

  if (loading || authLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-[var(--accent)] border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto pb-12">
      <div className="flex items-center gap-3 px-4 py-3 sticky top-0 bg-[var(--background)]/95 backdrop-blur z-10">
        <button onClick={() => router.back()} className="p-1 active:scale-90" aria-label="뒤로">
          <ArrowLeft size={24} className="text-[var(--foreground)]" />
        </button>
        <h1 className="text-xl font-bold text-[var(--foreground)] flex-1">배송지 관리</h1>
        {!editing && (
          <button
            onClick={startNew}
            className="text-sm text-[var(--accent)] font-semibold inline-flex items-center gap-1 active:scale-95"
          >
            <Plus size={16} /> 추가
          </button>
        )}
      </div>

      {/* 폼 (편집/추가) */}
      {editing && (
        <div className="px-4 mb-3">
          <div className="card p-4 space-y-2">
            <p className="text-sm font-bold text-[var(--foreground)] mb-2">
              {editing === 'new' ? '새 배송지' : '배송지 수정'}
            </p>
            <input
              type="text" placeholder="별칭 (집, 회사 등)"
              value={form.label ?? ''}
              onChange={e => setForm({ ...form, label: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm"
            />
            <input
              type="text" placeholder="받는 사람 이름 *"
              value={form.recipient_name}
              onChange={e => setForm({ ...form, recipient_name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm"
            />
            <input
              type="tel" placeholder="연락처 (010-1234-5678) *"
              value={form.phone}
              onChange={e => setForm({ ...form, phone: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm"
            />
            <input
              type="text" placeholder="우편번호 *"
              value={form.postal_code}
              onChange={e => setForm({ ...form, postal_code: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm"
            />
            <input
              type="text" placeholder="기본 주소 *"
              value={form.address_line1}
              onChange={e => setForm({ ...form, address_line1: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm"
            />
            <input
              type="text" placeholder="상세 주소 (선택)"
              value={form.address_line2 ?? ''}
              onChange={e => setForm({ ...form, address_line2: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--card-border)] text-sm"
            />
            <label className="flex items-center gap-2 mt-2">
              <input
                type="checkbox"
                checked={form.is_default}
                onChange={e => setForm({ ...form, is_default: e.target.checked })}
                className="w-4 h-4 accent-emerald-500"
              />
              <span className="text-sm text-[var(--foreground)]">기본 배송지로 설정</span>
            </label>
            <div className="flex gap-2 mt-3">
              <button
                onClick={cancelEdit}
                className="flex-1 py-2.5 rounded-xl border border-[var(--card-border)] text-sm font-semibold text-[var(--muted)]"
              >
                취소
              </button>
              <button
                onClick={handleSave}
                disabled={submitting}
                className="flex-1 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-bold active:scale-95 disabled:opacity-50"
              >
                {submitting ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 목록 */}
      {list.length === 0 && !editing ? (
        <div className="text-center py-20 px-4">
          <MapPin size={48} className="mx-auto mb-4 text-[var(--muted)]" />
          <p className="text-sm text-[var(--muted)]">등록된 배송지가 없어요</p>
          <button
            onClick={startNew}
            className="mt-4 inline-flex items-center gap-1 px-5 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-bold active:scale-95"
          >
            <Plus size={16} /> 첫 배송지 추가
          </button>
        </div>
      ) : (
        <div className="px-4 space-y-2">
          {list.map(a => (
            <div key={a.id} className="card p-4">
              <div className="flex items-start justify-between mb-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-[var(--foreground)]">{a.recipient_name}</p>
                  {a.label && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--card-border)]/60 text-[var(--muted)]">
                      {a.label}
                    </span>
                  )}
                  {a.is_default && (
                    <span className="text-xs text-emerald-600 font-bold inline-flex items-center gap-0.5">
                      <Star size={12} fill="currentColor" /> 기본
                    </span>
                  )}
                </div>
              </div>
              <p className="text-xs text-[var(--muted)] mb-1">{a.phone}</p>
              <p className="text-xs text-[var(--foreground)]">
                [{a.postal_code}] {a.address_line1} {a.address_line2 ?? ''}
              </p>
              <div className="flex gap-1 mt-3 pt-3 border-t border-[var(--card-border)]">
                {!a.is_default && (
                  <button
                    onClick={() => handleSetDefault(a.id)}
                    className="flex-1 py-2 rounded-lg text-xs font-semibold text-emerald-600 active:scale-95"
                  >
                    기본 지정
                  </button>
                )}
                <button
                  onClick={() => startEdit(a)}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold text-[var(--muted)] active:scale-95 inline-flex items-center justify-center gap-1"
                >
                  <Edit2 size={12} /> 수정
                </button>
                <button
                  onClick={() => handleDelete(a.id)}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold text-red-500 active:scale-95 inline-flex items-center justify-center gap-1"
                >
                  <Trash2 size={12} /> 삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {toast && <AppToast text={toast.text} tone={toast.tone} onClose={() => setToast(null)} durationMs={2500} />}
    </div>
  );
}
