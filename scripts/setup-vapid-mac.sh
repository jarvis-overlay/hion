#!/bin/bash
# 맥북(운영 서버)에서 한 번만 실행하는 스크립트: 푸시 알림 키(VAPID)가 없으면 새로 만들어
# .env.local에 넣고, 다시 빌드한 뒤 앱을 재시작한다.
#   실행:  cd ~/hion && bash scripts/setup-vapid-mac.sh
# - 이미 키가 있으면 아무것도 바꾸지 않는다.
# - 새 키는 화면에 출력하지 않는다(파일에만 기록). 기존 .env.local은 백업해둔다.
# - 키가 바뀌면 예전에 등록한 알림 기기는 못 쓰게 되니, 알림 받을 기기마다
#   "알림 설정 > 이 기기 등록하기"를 다시 눌러야 한다.
set -e

cd "$(dirname "$0")/.."
ENV_FILE=".env.local"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ $ENV_FILE 파일이 없어요. ~/hion 폴더에서 실행했는지 확인해주세요."
  exit 1
fi

has_pub=0
has_priv=0
grep -qE '^NEXT_PUBLIC_VAPID_PUBLIC_KEY=.+' "$ENV_FILE" && has_pub=1 || true
grep -qE '^VAPID_PRIVATE_KEY=.+' "$ENV_FILE" && has_priv=1 || true

if [ "$has_pub" = "1" ] && [ "$has_priv" = "1" ]; then
  echo "✅ 이미 VAPID 키 두 개가 모두 있어요. 파일은 바꾸지 않아요."
  echo "   그래도 알림이 안 가면 다시 빌드가 필요할 수 있어요:  npm run build && pm2 restart hion"
  exit 0
fi

if [ "$has_pub" = "1" ] || [ "$has_priv" = "1" ]; then
  echo "⚠️ 키가 한 개만 들어 있어요(짝이 안 맞음). 덮어쓰면 위험해서 멈춰요."
  echo "   .env.local에서 NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY 두 줄을 직접 확인해주세요."
  exit 1
fi

echo "🔑 VAPID 키를 새로 만들어요..."
KEYS_JSON="$(npx --yes web-push generate-vapid-keys --json)"

BACKUP="$ENV_FILE.bak-$(date +%Y%m%d%H%M%S)"
cp "$ENV_FILE" "$BACKUP"
chmod 600 "$BACKUP" || true
echo "   기존 설정 백업: $BACKUP"

# 키는 화면에 찍지 않고 파일에만 추가한다
KEYS_JSON="$KEYS_JSON" ENV_FILE="$ENV_FILE" node -e '
const fs = require("fs");
const k = JSON.parse(process.env.KEYS_JSON);
if (!k.publicKey || !k.privateKey) { console.error("키 생성 결과를 읽지 못했어요."); process.exit(1); }
const f = process.env.ENV_FILE;
let cur = fs.readFileSync(f, "utf8");
if (cur.length && !cur.endsWith("\n")) cur += "\n";
cur += "NEXT_PUBLIC_VAPID_PUBLIC_KEY=" + k.publicKey + "\nVAPID_PRIVATE_KEY=" + k.privateKey + "\n";
fs.writeFileSync(f, cur);
'
echo "✅ $ENV_FILE에 VAPID 키 2줄을 추가했어요."

echo "🔨 다시 빌드해요(NEXT_PUBLIC 값은 빌드할 때 들어가요). 1~3분 걸려요..."
npm run build

echo "♻️ 앱을 재시작해요..."
pm2 restart hion

echo ""
echo "🎉 끝났어요. 이제 알림 받을 기기마다 '알림 설정 > 이 기기 등록하기'를 다시 눌러주세요."
echo "   (예전에 등록한 기기는 키가 바뀌어서 못 쓰게 돼요)"
