'use client';

// 프로필 사진 등 원형 crop 모달.
// react-easy-crop 으로 이미지 위에서 핀치/드래그/줌 → 원형 mask 안 영역만 잘라 File 반환.
//
// 사용:
//   <ImageCropModal
//     src={URL.createObjectURL(file)}
//     onCancel={() => setSrc(null)}
//     onCropped={(blob) => { upload(new File([blob], 'avatar.jpg', { type: 'image/jpeg' })); }}
//   />

import { useCallback, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { X, Check } from 'lucide-react';

interface Props {
  src: string;
  onCancel: () => void;
  onCropped: (blob: Blob) => void;
  /** 출력 크기 (px). 기본 512 — 프로필 표시에는 충분, 파일 크기 작음 */
  outputSize?: number;
  /** 1 = 정사각 (원형 mask 와 같이 사용). 자유 비율 필요하면 다른 값 */
  aspect?: number;
}

async function getCroppedBlob(src: string, area: Area, outputSize: number): Promise<Blob> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
  const canvas = document.createElement('canvas');
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas context 없음');
  ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, outputSize, outputSize);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('blob 생성 실패'))),
      'image/jpeg',
      0.92,
    );
  });
}

export default function ImageCropModal({ src, onCancel, onCropped, outputSize = 512, aspect = 1 }: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);

  const onCropComplete = useCallback((_: Area, areaPixels: Area) => {
    setCroppedArea(areaPixels);
  }, []);

  const handleConfirm = async () => {
    if (!croppedArea || busy) return;
    setBusy(true);
    try {
      const blob = await getCroppedBlob(src, croppedArea, outputSize);
      onCropped(blob);
    } catch (e) {
      console.warn('[ImageCropModal] crop 실패', e);
      onCancel();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black">
      {/* Cropper 풀 스크린 — X / 확인 / 슬라이더 모두 이미지 위 floating overlay (모던 UI). */}
      <div className="absolute inset-0 bg-black">
        <Cropper
          image={src}
          crop={crop}
          zoom={zoom}
          aspect={aspect}
          cropShape="round"
          showGrid={false}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
        />
      </div>

      {/* 상단 floating: X (좌) / 확인 (우). status bar 영역 피해 safe-area-inset-top 사용. */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 pb-3 bg-gradient-to-b from-black/55 to-transparent z-10"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)' }}
      >
        <button
          onClick={onCancel}
          aria-label="취소"
          className="w-11 h-11 rounded-full bg-black/55 backdrop-blur flex items-center justify-center active:scale-90"
        >
          <X size={22} strokeWidth={2.5} className="text-white" />
        </button>
        <button
          onClick={handleConfirm}
          disabled={busy || !croppedArea}
          className="px-5 py-2.5 rounded-full bg-emerald-500 text-white font-bold text-sm shadow-lg disabled:opacity-50 active:scale-95 inline-flex items-center gap-1.5"
        >
          {busy ? '저장 중…' : <><Check size={18} strokeWidth={2.5} />확인</>}
        </button>
      </div>

      {/* 줌 슬라이더 — Cropper 영역 안 하단 1/4 지점 overlay (사용자 피드백: 너무 아래라 위로). */}
      <div
        className="absolute bottom-0 left-0 right-0 px-6 pt-4 bg-gradient-to-t from-black/80 via-black/50 to-transparent z-10"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 20px)' }}
      >
        <div className="flex items-center gap-3 max-w-md mx-auto">
          <span className="text-white text-xs select-none">축소</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1 accent-emerald-500"
          />
          <span className="text-white text-xs select-none">확대</span>
        </div>
      </div>
    </div>
  );
}
