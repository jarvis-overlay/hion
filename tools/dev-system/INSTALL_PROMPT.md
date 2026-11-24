# 다른 PC의 Claude Code에 붙여 넣을 설치 요청문

아래 블록을 복사해서 붙여 넣고 **`<키트 폴더 경로>`와 `<서버 주소>`만 바꾼다.** (운영 서버가 없으면 해당 줄을 지운다.)

```
<키트 폴더 경로> 폴더에 "Claude Code 개발부서 체계" 이식 키트가 있어. 이걸 이 PC의 내 Claude Code 개인 설정(~/.claude)에 설치해줘.

순서:
1. 그 폴더의 README.md를 읽고 어떤 파일이 어디에 설치되는지 나에게 한 줄로 요약해줘.
2. python 이 사용 가능한지 확인해줘 (python --version). 없으면 설치 방법만 알려주고 멈춰.
3. `python install.py --dry-run` 을 실행해서 결과(추가/덮어쓸 파일, settings.json 변경)를 보여주고, 내가 승인하면 진행해.
   - 배포 서버 주소가 있다면: --prod-host <서버 주소> 를 붙여줘. (없으면 생략)
4. 승인하면 `python install.py` 를 실행하고, 마지막의 가드 시험이 통과(failures: 0)했는지 알려줘.
5. 설치가 끝나면, 새 세션을 열어야 /agents 와 /dev /resume /handover /project-setup 이 보인다고 나에게 안내해줘.

주의:
- 키트 안의 파일 내용을 임의로 수정하지 마.
- install.py 가 하는 일(파일 복사, settings.json 훅 병합) 외에는 하지 마. 다른 설정은 건드리지 마.
- 오류가 나면 원인을 설명하고 멈춰. 마음대로 우회하지 마.
```

## 설치 후 확인 (사람이 직접)
1. Claude Code 새 세션 → `/agents` 입력 → `dev-planner` … `dev-docs` 10개가 보이면 성공.
2. `/` 입력 → `dev`, `resume`, `handover`, `project-setup`이 보이면 성공.
3. 아무 프로젝트에서 `/project-setup` 또는 `/dev 작은 요청`으로 시험.
