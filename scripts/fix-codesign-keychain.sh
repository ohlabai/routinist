#!/bin/bash
# codesign 키체인 영구 해결
#
# 증상: SSH 세션에서 `fastlane beta` 의 archive 가 codesign 단계에서
#       errSecInternalComponent 로 죽는다 (인증서는 멀쩡한데 개인키 접근 거부).
# 원인: 로그인 키체인이 잠겨 있거나, 개인키 ACL 이 "사용자 승인 프롬프트"를 요구.
#       SSH 세션엔 프롬프트를 띄울 화면이 없어서 그냥 실패한다.
# 해결: 키체인 잠금 해제 + 자동 잠금 끄기 + codesign 을 키 파티션 목록에 등록.
#       파티션 목록은 키체인에 저장되므로 재부팅 후에도 유지된다.
#
# 사용: Mac 터미널에서 (SSH 든 GUI 든 직접 비밀번호를 칠 수 있는 곳)
#   bash ~/routinist/scripts/fix-codesign-keychain.sh
#
# 비밀번호는 이 프로세스 안에서만 쓰이고 파일·로그에 남지 않는다.

set -uo pipefail

KC="$HOME/Library/Keychains/login.keychain-db"

if [ ! -f "$KC" ]; then
  echo "❌ 로그인 키체인을 못 찾음: $KC"
  exit 1
fi

printf 'Mac 로그인 비밀번호: '
read -rs PW
printf '\n\n'

echo "1/4  키체인 잠금 해제"
if ! security unlock-keychain -p "$PW" "$KC" 2>/dev/null; then
  echo "     ❌ 비밀번호가 맞지 않습니다"
  exit 1
fi
echo "     ok"

echo "2/4  자동 잠금 끄기 (절전·타임아웃으로 다시 잠기지 않게)"
security set-keychain-settings "$KC" && echo "     ok"

echo "3/4  codesign 에 개인키 접근 권한 부여 (partition list)"
if security set-key-partition-list \
      -S apple-tool:,apple:,codesign:,security: \
      -s -k "$PW" "$KC" >/dev/null 2>&1; then
  echo "     ok"
else
  echo "     ⚠️  partition list 설정 실패 — 검증 결과를 보고 판단"
fi

echo "4/4  검증 — 실제로 서명해봅니다"
TMP="$(mktemp -d)"
cp /bin/echo "$TMP/signtest"
RC=0
for NAME in "Apple Distribution" "Apple Development"; do
  ID="$(security find-identity -v -p codesigning | awk -v n="$NAME" '$0 ~ n {print $2; exit}')"
  [ -z "$ID" ] && { echo "     ($NAME 인증서 없음 — 건너뜀)"; continue; }
  OUT="$(codesign --force --sign "$ID" "$TMP/signtest" 2>&1)"
  if printf '%s' "$OUT" | grep -q errSec; then
    echo "     ❌ $NAME → $(printf '%s' "$OUT" | tail -1)"
    RC=1
  else
    echo "     ✅ $NAME 서명 성공"
  fi
done
rm -rf "$TMP"
unset PW

echo
if [ $RC -eq 0 ]; then
  echo "✅ 완료. 이제 SSH 세션에서도 archive 가 됩니다."
  echo "   Claude 에게 '됐어' 라고만 알려주시면 fastlane beta 를 이어서 돌립니다."
else
  echo "❌ 아직 막혀 있습니다. Claude 에게 이 출력 그대로 알려주세요."
  echo "   (다음 수단: 전용 CI 키체인에 .p12 로 인증서를 옮겨 심는 방식)"
fi
exit $RC
