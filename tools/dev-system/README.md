# Claude Code 개발부서 체계 — 개인 PC용 설치 키트

역할이 나뉜 에이전트 4개(기획+설계·구현·리뷰+검사·교차 검증)가 **규모(S/M/L)에 맞춰 필요한 만큼만** 개발하게 하는, 토큰 절약형 개인용 설정을
**다른 PC(개인 PC 포함)의 Claude Code에 그대로 설치**하는 키트다. 특정 회사·프로젝트에 묶인 내용은 없다. (상세 설명: `payload/dev-system/README.md`)

## 들어 있는 것
| 폴더/파일 | 설치되는 곳(`~/.claude/`) | 내용 |
|---|---|---|
| `payload/agents/dev-*.md` (4개) | `agents/` | 역할 에이전트 |
| `payload/commands/*.md` (4개) | `commands/` | `/dev` `/resume` `/handover` `/project-setup` |
| `payload/hooks/guard.py`, `test_guard.py` | `hooks/` | 안전 가드(강제 푸시·`--no-verify`·`git add -A`·시크릿 스테이징 차단) + 시험(프로젝트 설정 포함) |
| `payload/dev-system/` | `dev-system/` | 설명서, 프로젝트 `CLAUDE.md` 기준 |
| `install.py` | — | 설치기 (백업·병합·멱등, `--dry-run`, `--uninstall`) |
| `export.py` | — | 지금 PC의 `~/.claude`에서 payload를 갱신(키트 업데이트용) |
| `INSTALL_PROMPT.md` | — | 설치할 PC의 Claude에게 붙여 넣을 요청문 |

키트에는 토큰·키·비밀번호·서버 주소가 들어 있지 않다.

## 설치 방법

**준비물**: Claude Code(데스크톱 앱 Code 탭 또는 CLI), Python 3. Windows는 Git for Windows(Git Bash)도 필요하다.
zip을 그 PC로 옮겨 압축을 푼다.

### 방법 A — Claude에게 시키기 (권장)
1. 그 PC의 Claude Code에서 아무 폴더로 세션을 연다.
2. `INSTALL_PROMPT.md`의 내용을 붙여 넣고, 키트 폴더 경로만 바꾼다.
3. Claude가 먼저 `--dry-run`으로 계획을 보여 주고, 승인하면 설치한다.

### 방법 B — 직접 실행
```
cd 키트폴더
python install.py --dry-run                 # 무엇을 할지만 확인
python install.py                           # 설치
```
배포 서버가 있어서 그 서버로 가는 명령에 확인창을 띄우고 싶으면 `python install.py --prod-host <서버 주소>`(여러 번 가능). 없으면 생략한다.

설치 후 **Claude Code를 새 세션으로 열면** `/agents`에 `dev-*` 에이전트가, `/` 목록에 `dev`·`resume`·`handover`·`project-setup`이 보인다.

## 설치기가 하는 일 / 안 하는 일
- 하는 일: `~/.claude/`에 파일 복사(이미 있고 다르면 `backups-dev-system/<시각>/`에 백업 후 덮어씀), `settings.json`에 **가드 훅만 병합**(다른 설정·다른 훅은 유지, 중복 등록 없음), 가드 시험 실행.
- 안 하는 일: 프로젝트 파일 수정, 네트워크 접속, 다른 설정 변경. 여러 번 실행해도 안전하다.
- 제거: `python install.py --uninstall` (설치한 파일과 훅만 제거).

## 쓰는 법
- `/resume`(시작) → 작업 브랜치 → `/dev <요청>` → `/handover`(종료).
- 새 프로젝트에서는 `/dev`가 시작할 때 `CLAUDE.md`를 점검하고, 없으면 초안을 만들어 승인받는다(`/project-setup`으로 따로 실행 가능).
- 작은 수정은 `/dev` 없이 그냥 대화로 시키는 게 훨씬 싸다. "기획 검토만"이라고 하면 설계까지만 하고 멈춘다.

## 토큰 사용량
- 타입 검사·시험·가드 훅(토큰 거의 0)을 먼저, 에이전트는 보강. S는 에이전트 없이 직접 처리.
- opus는 위험한 변경의 "높음" 지적 교차 검증에만. 나머지는 sonnet/세션 모델.
- 수정은 최대 1라운드, 재검증은 고친 diff만, 범위 밖 발견은 백로그.

## 알아둘 것
- 에이전트 모델(`opus`, `sonnet`)은 그 계정에서 쓸 수 있을 때만 동작한다. 쓸 수 없으면 에이전트 파일 맨 위 `model:`을 `inherit`로 바꾼다.
- 가드 훅은 `python`이 PATH에 있어야 한다. 훅 경로는 설치 때 그 PC의 `~/.claude` 절대 경로로 기록되므로, 폴더를 옮기면 `install.py`를 다시 실행한다.
- 가드는 안전망이지 보안 경계가 아니다(Bash 명령 문자열만 해석).

## 키트를 업데이트하려면 (원본 PC에서)
`~/.claude`의 파일을 고친 뒤 `python export.py`로 payload를 갱신하고 zip을 다시 만든다. 설치한 PC에서는 `python install.py`를 다시 실행하면 바뀐 파일만 백업 후 갱신된다.

## 이 저장소(hion)에서의 맞춤 — 프로젝트별 설정
프로젝트 루트 `.claude/dev-system.json` (가드 훅이 작업 폴더에서 위로 올라가며 찾는다):
```
{ "allow_main_push": true, "prod_hosts": [] }
```
- `allow_main_push: true` — main/master 푸시를 막지 않음(hion은 푸시=맥북 배포). 강제 푸시·`--no-verify`·`git add -A`·시크릿 스테이징은 계속 차단. 설정이 없으면 main 푸시도 차단(엄격한 기본값).
- `prod_hosts` — 이 프로젝트에서만 확인을 요구할 운영 서버 주소.
- 설치: 각 PC(jarvis, wook)에서 `python tools/dev-system/install.py` (먼저 `--dry-run`). 키트 파일을 고치면 git으로 공유하고 각 PC에서 `install.py`를 다시 실행.
