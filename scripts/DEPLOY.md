# 맥북 자동배포 (무중단 + 실패 시 자동 복구)

`main`에 푸시하면 맥북이 90초 안에 받아서 빌드하고 전환한다. 스크립트는 이 저장소의
`scripts/deploy-watch.sh`이고, 맥북에서는 launchd(`com.hion.autodeploy`)가 90초마다 실행한다.

## 옛 방식과 달라진 점 (2026-11-08~10 장애 재발 방지)

| 옛 방식 | 새 방식 |
|---|---|
| 실행 중인 서버의 `.next`를 그 자리에서 지우며 빌드 → 빌드 중·실패 후 사이트가 깨짐 | 서버가 안 쓰는 칸(`.next-a` / `.next-b`)에 빌드. 빌드 중에도 사이트는 그대로 |
| 빌드가 끝나면 무조건 재시작 | 빌드 성공 + **로그인 페이지와 정적 파일(CSS/JS)이 실제로 나오는지** 확인해야 전환. 실패하면 이전 칸으로 되돌림 |
| `npm install` 실패를 확인하지 않고 빌드로 진행 | 설치가 실패하면 중단 (기존 사이트 유지) |
| 한 번 실패하면 HEAD가 이미 최신이라 다시 시도 안 함 | "마지막 배포 성공 커밋"을 따로 기록, 실패한 커밋은 30분 뒤 자동 재시도 |
| 중간에 죽으면 `/tmp` 잠금이 남아 배포가 영영 멈춤 | 잠금에 프로세스 번호를 적어 죽은/45분 넘은 잠금은 스스로 치움 |
| `~/.npm` 일부가 root 소유라 `npm install` 실패 | 전용 캐시 폴더(`~/.npm-hion`) 사용 |
| 서버 폴더에 수정이 있으면 `git pull` 실패 → 배포 멈춤 | 수정은 `git stash`에 보관하고 계속 진행 |

## 맥북에 한 번만 설치 (사용자가 맥북 터미널에서)

1. `main`에 이 변경이 푸시되면 **옛 스크립트가 알아서 한 번 받아옵니다**(옛 방식 그대로 빌드, 안전). 90초쯤 기다리거나 아래로 직접 받아도 됩니다.
```bash
cd /Users/wook/hion && git pull
```

2. 맥북의 자동배포 파일을 새 스크립트로 연결 (이후 스크립트 개선은 `git push`만으로 반영됨). 옛 파일은 백업해 두고, 같은 이름을 새 스크립트의 바로가기(심볼릭 링크)로 바꿉니다. 따옴표가 없어서 윈도우 PowerShell에서 `ssh hion-mac '...'` 한 줄로 보내도 깨지지 않습니다 (2026-11-22 이 방식으로 설치함).
```bash
cp /Users/wook/deploy-watch.sh /Users/wook/deploy-watch.sh.old && ln -sf /Users/wook/hion/scripts/deploy-watch.sh /Users/wook/deploy-watch.sh
```

3. (선택) 한 번 직접 실행해서 확인. 바로가기만 걸어 두면 launchd가 90초 안에 알아서 처음 배포를 하므로 `tail -25 /Users/wook/.pm2/autodeploy.log`로 결과만 봐도 됩니다. (처음엔 기록이 없어서 현재 커밋을 한 번 빌드·전환합니다. 1~4분 걸리고 그동안 사이트는 그대로예요)
```bash
/bin/bash /Users/wook/deploy-watch.sh
```
   끝에 `배포 완료 (...)` 가 나오면 성공. `배포 실패` 가 나오면 그 이유가 바로 위에 적혀 있다.

4. 확인
```bash
export PATH="$HOME/bin:$HOME/.npm-global/bin:$PATH"; pm2 list; curl -sI https://hion.cc/login | head -3; cat ~/.hion-deploy/slot
```
   `slot`이 `a`나 `b`이고 `hion`이 `online`이면 정상. 이후부터는 launchd가 90초마다 알아서 돈다.

## 평소 확인/문제 해결

- 최근 기록: `tail -40 /Users/wook/.pm2/autodeploy.log`
- 상태 파일(`~/.hion-deploy/`): `slot`(지금 서비스 중인 칸 a/b), `deployed_sha`(마지막 성공 커밋), `failed`(실패한 커밋·시각·이유), `lock_hash`(마지막 설치 성공 시점의 `package-lock.json`)
- **배포 실패 로그가 보이면**: 사이트는 이전 버전으로 계속 서비스 중이다. 원인(로그에 적힘)을 고치고 푸시하면 90초 안에 다시 시도. 같은 커밋은 30분 뒤 자동 재시도.
- **지금 바로 다시 시도**: `rm ~/.hion-deploy/failed` 후 스크립트를 한 번 실행.
- **수동 재시작은 `pm2 restart hion`만** 쓰세요. `pm2 delete hion` 후 `pm2 start ...`로 새로 만들면 `NEXT_DIST_DIR`(어느 칸을 서비스하는지)가 사라져 옛 `.next`를 보게 됩니다. 그랬다면 `rm ~/.hion-deploy/deployed_sha` 후 스크립트를 한 번 실행하면 다시 맞춰집니다.
- 맥북이 재부팅돼도 `pm2 save`로 서비스 칸이 저장돼 있어서 같은 칸으로 올라온다.
- 디스크: 칸 2개(각 수백 MB)가 남는다. 옛 `.next`는 처음 전환이 끝나면 지워도 된다: `rm -rf /Users/wook/hion/.next`

## 이 PC에서 검증한 것 / 못 한 것

- **검증함**: `bash scripts/test-deploy-watch.sh` (가짜 git 저장소 + 가짜 npm/pm2/curl) 38개 확인 — 첫 배포, 변경 없을 때 무동작, lock 변경 시 설치, 빌드 실패 시 서비스 유지·재시도 대기, 설치 실패, 전환 후 확인 실패 시 롤백, 정적 파일 400 감지, 잠금(죽은/살아 있는), 서버 폴더 수정 충돌, 배포 중 스크립트 자체 교체.
- **검증함(실제)**: `NEXT_DIST_DIR=.next-a`로 `next build` 성공, 같은 값으로 `next start` 후 `/login`과 `/_next/static/*` 모두 200. 빌드가 `tsconfig.json`을 건드리지 않음.
- **실제 맥북에서 확인함 (2026-11-22)**: 바로가기로 연결한 뒤 launchd가 새 스크립트를 실행 → `서버를 .next-a 로 전환` → `배포 완료 (259f444…, 서비스 칸: .next-a)`, 상태 파일(`slot`=a, `deployed_sha`, `lock_hash`) 생성, `hion.cc/login`과 정적 파일 6개 모두 200.
- **아직 못 본 것**: 푸시로 일어나는 두 번째 배포(b 칸으로 전환), 맥북 재부팅 후 `pm2 save`로 저장된 칸 복원, 빌드/설치 실패 시 실제 롤백(가짜 환경 시험만 함).
