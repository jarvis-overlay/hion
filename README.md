# 비즈니스 허브 (1단계)

욱이랑 형 둘이 쓰는 내부 도구 웹앱.
Next.js + Supabase(로그인/DB) + Vercel(호스팅) 조합, 셋 다 무료 티어로 충분함.

**1단계 카테고리**
- 마진 계산기
- 소싱
  - 소싱 정보 (공급업체 정보, 팁, 관세/통관 정보 등 자유 기록)
  - 소싱 리스트 (소싱 후보 상품을 검토중/발주완료/보류로 관리)

**2단계 예정 (1단계 안정화 후 추가)**
- 썸네일 제작
- 상세페이지 제작

---

## 0. 준비물
- GitHub 계정 (이미 있음)
- Supabase 계정 (supabase.com, 구글/깃허브로 바로 가입 가능)
- Vercel 계정 (vercel.com, 깃허브 계정으로 바로 가입 가능)
- Google Cloud Console 계정 (구글 로그인용 OAuth 키 발급, 구글 계정만 있으면 됨)

---

## 1. Supabase 프로젝트 만들기

1. supabase.com → New Project
2. 이름, 비밀번호(DB 비밀번호, 아무거나 강력하게) 설정하고 리전은 **Northeast Asia (Seoul)** 선택
3. 프로젝트 생성되면 왼쪽 메뉴 **SQL Editor** 클릭
4. 이 프로젝트의 `supabase/schema.sql` 파일 내용을 전부 복사해서 붙여넣고 실행 (Run)
5. 맨 아래 주석 처리된 부분
   ```sql
   insert into allowed_users (email) values
     ('me@gmail.com'),
     ('hyung@gmail.com');
   ```
   을 욱이랑 형 실제 구글 이메일로 바꿔서 주석 해제하고 다시 실행 → 이게 로그인 허용 목록임
6. 왼쪽 메뉴 **Project Settings → API** 에서
   - `Project URL` → `.env.local`의 `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` 키 → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   나중에 쓸 거니까 복사해두기

---

## 2. 구글 로그인(OAuth) 연결

1. Supabase 프로젝트 → **Authentication → Providers → Google** 켜기
2. Google Cloud Console (console.cloud.google.com) 접속 → 새 프로젝트 생성
3. **APIs & Services → OAuth consent screen** → External로 설정, 앱 이름/이메일만 입력하고 저장
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: Web application
   - Authorized redirect URIs 에 Supabase가 알려주는 콜백 URL 붙여넣기
     (Supabase의 Google Provider 설정 화면에 `https://xxxx.supabase.co/auth/v1/callback` 형태로 나와있음, 그대로 복사)
5. 발급된 **Client ID / Client Secret**을 Supabase의 Google Provider 설정 화면에 붙여넣고 저장

---

## 3. 로컬에서 실행해보기 (선택, 확인용)

```bash
npm install
cp .env.local.example .env.local
# .env.local 파일 열어서 1번에서 복사한 URL/키 붙여넣기
npm run dev
```

브라우저에서 http://localhost:3000 접속 → 구글 로그인 되는지 확인

---

## 4. GitHub에 올리기

```bash
git init
git add .
git commit -m "init: 소싱 허브"
git branch -M main
git remote add origin https://github.com/{내깃허브아이디}/biz-hub.git
git push -u origin main
```

(GitHub에서 새 repository를 먼저 만들어야 함 — Public/Private 상관없음, Private 추천)

---

## 5. Vercel로 배포

1. vercel.com → New Project → 방금 만든 GitHub repo 선택 → Import
2. **Environment Variables** 섹션에 1번에서 복사해둔 값 입력
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Deploy 클릭 → 몇 분 뒤 `https://sourcing-hub-xxxx.vercel.app` 같은 주소 생성됨
4. 이 주소를 Google Cloud Console의 **Authorized redirect URIs**에도 추가해줘야 함:
   `https://sourcing-hub-xxxx.vercel.app` 도메인 자체는 Supabase가 콜백을 처리하니 필수는 아니지만,
   OAuth consent screen의 **Authorized domains**에 `vercel.app`(또는 커스텀 도메인)을 추가해두면 안전함

이후로는 `git push`만 하면 Vercel이 알아서 자동 재배포함.

---

## 6. 앞으로 기능 추가하는 흐름

- 새 기능 아이디어 있으면 이 프로젝트 폴더 통째로 Claude Code에 열어서 요청하면 됨
  (지금처럼 채팅으로도 계속 확장 가능하지만, 코드가 커질수록 Claude Code가 훨씬 편함)
- DB 테이블을 추가/수정할 땐 `supabase/schema.sql`에도 반영해서 히스토리 남기기
- 로컬에서 `npm run dev`로 먼저 확인 → `git push` 하면 자동배포

---

## 폴더 구조

```
app/
  login/                  # 로그인 페이지
  auth/callback/           # OAuth 콜백 처리
  dashboard/
    layout.tsx              # 로그인 + 허용 이메일 체크
    margin/                  # 마진 계산기
    sourcing/
      info/                   # 소싱 정보 (자유형 노트)
      list/                   # 소싱 리스트 (구조화된 후보 관리)
lib/supabase/              # Supabase 클라이언트 (브라우저용 / 서버용)
components/                 # 재사용 UI 컴포넌트
supabase/schema.sql         # DB 테이블 + 보안 정책(RLS)
```

2단계(썸네일 제작, 상세페이지 제작)는 같은 방식으로
`app/dashboard/thumbnail/`, `app/dashboard/detail-page/` 같은 폴더를 추가하고
Navbar에 링크만 추가해주면 됨 — 1단계가 안정적으로 배포되고 나면 이어서 진행.
