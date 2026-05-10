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
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 py-3 bg-black/90 text-white">
        <button onClick={onCancel} className="p-2 active:scale-90" aria-label="취소">
          <X size={26} strokeWidth={2.5} />
        </button>
        <h3 className="text-base font-semibold">프로필 사진 자르기</h3>
        <button
          onClick={handleConfirm}
          disabled={busy || !croppedArea}
          className="px-4 py-1.5 rounded-full bg-emerald-500 text-white font-bold text-sm disabled:opacity-50 active:scale-95"
        >
          {busy ? '...' : <span className="inline-flex items-center gap-1"><Check size={16} />확인</span>}
        </button>
      </div>
      {/* Cropper */}
      <div className="flex-1 relative bg-black">
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
      {/* Zoom 슬라이더 */}
      <div className="px-6 py-4 bg-black/90">
        <div className="flex items-center gap-3">
          <span className="text-white text-xs">축소</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1 accent-emerald-500"
          />
          <span className="text-white text-xs">확대</span>
        </div>
        <p className="text-center text-xs text-white/60 mt-2">손가락으로 사진 위치를 옮기고 슬라이더로 확대·축소하세요</p>
      </div>
    </div>
  );
}
