#!/usr/bin/env node
// Play Store Feature Graphic — 1024x500 PNG.
// Routinist 글리프 + 슬로건 한 줄.
import sharp from 'sharp';

const W = 1024, H = 500;
const BG = '#0F1525';

async function main() {
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#10b981"/>
        <stop offset="1" stop-color="#34d399"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="${BG}"/>
    <text x="500" y="240" font-family="Helvetica, Arial, sans-serif" font-size="84" font-weight="800" fill="url(#g)">Routinist</text>
    <text x="500" y="310" font-family="Helvetica, Arial, sans-serif" font-size="32" font-weight="500" fill="#94a3b8">함께 달리고 함께 성장하는 러닝 SNS</text>
    <text x="500" y="360" font-family="Helvetica, Arial, sans-serif" font-size="24" font-weight="400" fill="#64748b">Run together. Grow together.</text>
  </svg>`;

  const iconBuf = await sharp('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png')
    .resize(280, 280)
    .png()
    .toBuffer();

  await sharp(Buffer.from(svg))
    .composite([{ input: iconBuf, top: 110, left: 130 }])
    .png()
    .toFile('android/app/src/main/feature-graphic.png');

  console.log('✓ Feature Graphic 1024x500 생성: android/app/src/main/feature-graphic.png');
}

main().catch((e) => { console.error(e); process.exit(1); });
