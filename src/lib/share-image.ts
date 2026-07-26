// 이미지 URL → 네이티브 공유 시트 (저장/공유). ShareCard.sharePngBlob 패턴의 재사용 버전.
// build 317 (2026-07-26): 루틴포토 라이트박스 "원본 저장" 용으로 분리.

function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  const p = cap?.getPlatform?.();
  return p === 'ios' || p === 'android';
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** URL 의 이미지를 받아 공유 시트를 띄운다. 네이티브 = Capacitor Share, 웹 = navigator.share, 폴백 = 다운로드. */
export async function shareImageUrl(url: string, fileName: string, dialogTitle?: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`이미지 로드 실패 (${res.status})`);
  const blob = await res.blob();

  if (isNativeApp()) {
    const dataUrl = await blobToDataUrl(blob);
    const base64 = dataUrl.split(',')[1];
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const result = await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache });
    const { Share } = await import('@capacitor/share');
    await Share.share({ url: result.uri, dialogTitle: dialogTitle ?? '사진 저장' });
    return;
  }
  if (typeof navigator !== 'undefined' && navigator.share) {
    const file = new File([blob], fileName, { type: blob.type || 'image/jpeg' });
    await navigator.share({ files: [file] });
    return;
  }
  // 데스크탑 웹 폴백 — 다운로드
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
