#!/usr/bin/env node
// Routinist Android 런처 아이콘 생성 — iOS AppIcon (1024x1024) 을 소스로
// 모든 mipmap 밀도 + 적응형 아이콘 foreground/background + Play Store 512 생성.
import sharp from 'sharp';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

const SRC = 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png';
const RES = 'android/app/src/main/res';

const LEGACY = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const FG = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const BG_HEX = '#0F1525'; // iOS 아이콘 배경 (deep navy)

async function ensureDir(p) { await mkdir(p, { recursive: true }); }

async function main() {
  // Legacy square + round launcher (pre-Android 8)
  for (const [d, size] of Object.entries(LEGACY)) {
    const dir = path.join(RES, `mipmap-${d}`);
    await ensureDir(dir);
    await sharp(SRC).resize(size, size).webp({ quality: 90 }).toFile(path.join(dir, 'ic_launcher.webp'));
    await sharp(SRC).resize(size, size).webp({ quality: 90 }).toFile(path.join(dir, 'ic_launcher_round.webp'));
  }

  // Adaptive foreground — full icon (Routinist 글리프). 외곽 safe-zone 위해 약간 padding.
  for (const [d, size] of Object.entries(FG)) {
    const dir = path.join(RES, `mipmap-${d}`);
    await ensureDir(dir);
    const inset = Math.round(size * 0.22);
    const inner = size - inset * 2;
    const composed = await sharp({
      create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: await sharp(SRC).resize(inner, inner).png().toBuffer(), top: inset, left: inset }])
      .png()
      .toBuffer();
    await sharp(composed).webp({ quality: 90 }).toFile(path.join(dir, 'ic_launcher_foreground.webp'));
  }

  // ic_launcher_background.xml — solid navy. (기존 위치: res/values/ic_launcher_background.xml)
  const valuesDir = path.join(RES, 'values');
  await ensureDir(valuesDir);
  await writeFile(
    path.join(valuesDir, 'ic_launcher_background.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${BG_HEX}</color>
</resources>
`
  );

  // Play Store hi-res icon — 512x512
  await sharp(SRC).resize(512, 512).png().toFile('android/app/src/main/ic_launcher-playstore.png');

  console.log('✓ Android 아이콘 생성 완료');
}

main().catch((e) => { console.error(e); process.exit(1); });
