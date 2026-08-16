// iOS 스크린샷 (1320×2868, 9:19.5) → Play 9:16 (1080×1920) 변환.
// 배경: 원본을 cover 로 늘려 블러 → 위에 원본을 contain 으로 올림.
import sharp from 'sharp';
import { readdirSync, mkdirSync } from 'node:fs';

const SRC = '/Users/hans_macmini/routinist/ios/fastlane/screenshots/ko';
const OUT = '/Users/hans_macmini/routinist/play-screenshots';
const W = 1080, H = 1920;
mkdirSync(OUT, { recursive: true });

const files = readdirSync(SRC).filter((f) => f.endsWith('.png') && !f.startsWith('ipad'));
for (const f of files) {
  const src = `${SRC}/${f}`;
  const bg = await sharp(src).resize(W, H, { fit: 'cover' }).blur(30).modulate({ brightness: 0.75 }).toBuffer();
  const fg = await sharp(src).resize(W, H, { fit: 'inside' }).toBuffer();
  const fgMeta = await sharp(fg).metadata();
  await sharp(bg)
    .composite([{ input: fg, left: Math.round((W - fgMeta.width) / 2), top: Math.round((H - fgMeta.height) / 2) }])
    .png()
    .toFile(`${OUT}/${f}`);
  console.log(`${f} → ${W}x${H}`);
}
