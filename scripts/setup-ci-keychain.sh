#!/bin/bash
# 빌드 전용(CI) 키체인 구성 — SSH 세션에서 codesign 이 되도록 만든다.
#
# 왜 필요한가:
#   로그인 키체인의 개인키는 접근 시 "사용자 승인"을 요구한다. SSH 세션에는
#   그 프롬프트를 띄울 화면이 없어 codesign 이 errSecInternalComponent 로 죽는다.
#   partition list 를 손봐도 세션 경계를 넘지 못하는 경우가 있다(이 Mac 이 그 경우).
#
# 무엇을 하는가:
#   인증서+개인키를 별도 키체인(routinist-ci)으로 복사하고, 그 키체인의 비밀번호를
#   무작위로 만들어 ios/.env.fastlane (git 제외됨) 에 저장한다. 이후 빌드는 그 비밀번호로
#   키체인을 열기만 하면 되므로 사람 개입이 필요 없다.
#   로그인 키체인은 건드리지 않는다. 원본 인증서도 그대로 남는다.
#
# 사용: Mac 터미널에서   ~/g
#
# 되돌리기:
#   security delete-keychain ~/Library/Keychains/routinist-ci.keychain-db
#   security list-keychains -d user -s ~/Library/Keychains/login.keychain-db

set -uo pipefail

LOGIN_KC="$HOME/Library/Keychains/login.keychain-db"
CI_KC="$HOME/Library/Keychains/routinist-ci.keychain-db"
ENV_FILE="$HOME/routinist/ios/.env.fastlane"
LOG="/tmp/routinist-keychain-setup.log"
P12="$(mktemp -t routinist-signing).p12"

# 로그는 Claude 가 읽는다 — 비밀번호는 절대 여기 안 남긴다.
exec > >(tee "$LOG") 2>&1

cleanup() { rm -f "$P12"; }
trap cleanup EXIT

echo "=== routinist CI 키체인 구성 $(date '+%Y-%m-%d %H:%M:%S') ==="

printf 'Mac 로그인 비밀번호: '
read -rs LOGIN_PW
printf '\n\n'

CI_PW="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)"

echo "1/7  로그인 키체인 잠금 해제"
if ! security unlock-keychain -p "$LOGIN_PW" "$LOGIN_KC" 2>/dev/null; then
  echo "     ❌ 비밀번호가 맞지 않습니다"
  exit 1
fi
echo "     ok"

echo "2/7  security 도구에 키 접근 권한 부여 (export 하려면 필요)"
security set-key-partition-list -S apple-tool:,apple:,codesign:,security: \
  -s -k "$LOGIN_PW" "$LOGIN_KC" >/dev/null 2>&1 \
  && echo "     ok" || echo "     ⚠️ 실패 — export 가 프롬프트를 띄울 수 있음"

echo "3/7  인증서 + 개인키를 .p12 로 추출"
if ! security export -k "$LOGIN_KC" -t identities -f pkcs12 -P "$CI_PW" -o "$P12" 2>&1; then
  echo "     ❌ 추출 실패 — 이 세션도 개인키에 접근할 수 없습니다."
  echo "        이 경우 SSH 만으로는 방법이 없고 Xcode(GUI) 로 Archive 해야 합니다."
  exit 1
fi
echo "     ok ($(wc -c < "$P12" | tr -d ' ') bytes)"

echo "4/7  전용 키체인 생성"
security delete-keychain "$CI_KC" 2>/dev/null
security create-keychain -p "$CI_PW" "$CI_KC" || { echo "     ❌ 생성 실패"; exit 1; }
security set-keychain-settings "$CI_KC"          # 자동 잠금 없음
security unlock-keychain -p "$CI_PW" "$CI_KC"
echo "     ok"

echo "5/7  인증서 가져오기 + codesign 권한 부여"
security import "$P12" -k "$CI_KC" -P "$CI_PW" -A \
  -T /usr/bin/codesign -T /usr/bin/security -T /usr/bin/productbuild 2>&1 | sed 's/^/     /'
security set-key-partition-list -S apple-tool:,apple:,codesign: \
  -s -k "$CI_PW" "$CI_KC" >/dev/null 2>&1 \
  && echo "     partition list ok" || echo "     ⚠️ partition list 실패"

echo "6/7  검색 목록에 등록 (전용 키체인 우선)"
security list-keychains -d user -s "$CI_KC" "$LOGIN_KC"
security list-keychains -d user | sed 's/^/     /'

echo "7/7  비밀번호를 ios/.env.fastlane 에 저장"
if [ -f "$ENV_FILE" ]; then
  grep -v '^CI_KEYCHAIN_' "$ENV_FILE" > "$ENV_FILE.tmp" && mv "$ENV_FILE.tmp" "$ENV_FILE"
else
  mkdir -p "$(dirname "$ENV_FILE")"; : > "$ENV_FILE"
fi
{
  echo ""
  echo "# 빌드 전용 키체인 (setup-ci-keychain.sh 가 생성). git 제외 대상."
  echo "CI_KEYCHAIN_PATH=$CI_KC"
  echo "CI_KEYCHAIN_PW=$CI_PW"
} >> "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "     저장 완료 (권한 600)"

echo
echo "=== 검증 — 전용 키체인으로 실제 서명 ==="
TMP="$(mktemp -d)"; cp /bin/echo "$TMP/signtest"
security find-identity -v -p codesigning "$CI_KC" | sed 's/^/     /'
RC=1
while read -r HASH; do
  [ -z "$HASH" ] && continue
  OUT="$(codesign --force --keychain "$CI_KC" --sign "$HASH" "$TMP/signtest" 2>&1)"
  if printf '%s' "$OUT" | grep -q errSec; then
    echo "     ❌ $HASH → $(printf '%s' "$OUT" | tail -1)"
  else
    echo "     ✅ $HASH 서명 성공"; RC=0
  fi
done < <(security find-identity -v -p codesigning "$CI_KC" | awk '/[0-9A-F]{40}/{print $2}')
rm -rf "$TMP"
unset LOGIN_PW CI_PW

echo
if [ $RC -eq 0 ]; then
  echo "✅ 완료. Claude 에게 '됐어' 라고 알려주세요."
else
  echo "❌ 서명이 아직 안 됩니다. Claude 에게 알려주세요 (로그: $LOG)."
fi
exit $RC
