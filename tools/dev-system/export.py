#!/usr/bin/env python3
"""지금 PC의 ~/.claude 에서 개발부서 체계 파일을 payload/ 로 복사한다(키트 갱신용).

    python export.py            # ~/.claude → payload/
에이전트(dev-*.md), 명령(dev/resume/handover/project-setup), 훅(guard.py, test_guard.py), dev-system 문서만 가져온다.
guard_config.json(서버 주소)은 키트에 넣지 않는다 — 설치 때 --prod-host 로 지정.
"""
import shutil
import sys
from pathlib import Path

HOME = Path.home() / ".claude"
PAYLOAD = Path(__file__).resolve().parent / "payload"
COMMANDS = ["dev.md", "resume.md", "handover.md", "project-setup.md"]


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    if PAYLOAD.exists():
        shutil.rmtree(PAYLOAD)
    n = 0
    def put(src: Path, rel: str):
        nonlocal n
        if not src.exists():
            sys.exit(f"없음: {src}")
        dst = PAYLOAD / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst); n += 1
    for f in sorted((HOME / "agents").glob("dev-*.md")):
        put(f, f"agents/{f.name}")
    for name in COMMANDS:
        put(HOME / "commands" / name, f"commands/{name}")
    for name in ("guard.py", "test_guard.py"):
        put(HOME / "hooks" / name, f"hooks/{name}")
    for f in sorted((HOME / "dev-system").glob("*.md")):
        put(f, f"dev-system/{f.name}")
    print(f"payload/ 갱신: {n}개 파일")


if __name__ == "__main__":
    main()
