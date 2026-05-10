import { getSupabase } from './supabase';
import type { MileageTransaction } from '@/types';

export async function fetchMileageBalance(userId: string): Promise<number> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('profiles')
    .select('mileage_balance')
    .eq('id', userId)
    .single();
  return data?.mileage_balance ?? 0;
}

export async function fetchMileageTransactions(
  userId: string,
  limit = 50,
  offset = 0,
): Promise<MileageTransaction[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('mileage_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data || []) as MileageTransaction[];
}

// 탭 분류 — 사용자 피드백 #11.
// '러닝': run_earn + reward(distance_km, first_*, streak_*, monthly_goal_complete) — 본인 활동 기반
// '보상': gift_receive + signup + friend_invite_* + admin_adjust + refund — 외부에서 들어온 보상
// '사용': purchase_spend + gift_send — 차감
// (전체 탭은 모든 트랜잭션)
export function classifyMileageTx(tx: MileageTransaction): 'running' | 'reward' | 'spend' {
  if (tx.tx_type === 'run_earn') return 'running';
  if (tx.tx_type === 'reward') {
    const ev = tx.event_type ?? '';
    // 러닝 활동에서 발생한 보상은 '러닝'
    if (ev === 'distance_km' || ev.startsWith('first_') || ev.startsWith('streak_') || ev === 'monthly_goal_complete') {
      return 'running';
    }
    return 'reward';
  }
  if (tx.tx_type === 'gift_receive' || tx.tx_type === 'admin_adjust' || tx.tx_type === 'refund') return 'reward';
  return 'spend';
}

export async function giftMileage(
  senderId: string,
  receiverId: string,
  amount: number,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('gift_mileage', {
    p_sender_id: senderId,
    p_receiver_id: receiverId,
    p_amount: amount,
  });
  if (error) throw new Error(error.message === 'Insufficient mileage balance' ? '마일리지가 부족합니다' : error.message);
}

export function txTypeLabel(txType: string): string {
  const labels: Record<string, string> = {
    run_earn: '러닝 적립',
    purchase_spend: '구매 사용',
    gift_send: '선물 보냄',
    gift_receive: '선물 받음',
    admin_adjust: '관리자 조정',
    refund: '환불',
    reward: '보상',
  };
  return labels[txType] || txType;
}

export function txTypeColor(txType: string): string {
  if (txType === 'run_earn' || txType === 'gift_receive' || txType === 'refund' || txType === 'reward') return 'text-green-500';
  return 'text-red-500';
}
