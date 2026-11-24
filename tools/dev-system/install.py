#!/usr/bin/env python3
"""Claude Code 개발부서 체계 설치기 (개인용 키트).

    python install.py              # 현재 계정의 ~/.claude 에 설치
    python install.py --dry-run    # 무엇을 할지만 보여 줌(파일 변경 없음)
    python install.py --prod-host 10.0.0.5   # (선택) 운영 서버 주소 — 프로젝트별은 .claude/dev-system.json 의 prod_hosts 권장
    python install.py --uninstall  # 이 키트가 설치한 파일과 훅 제거
    python install.py --target D:\\x\\.claude   # (시험용) 다른 위치에 설치

하는 일:
  1. payload/ 의 에이전트·명령·훅·문서를 ~/.claude/ 에 복사. 이미 있고 내용이 다른 파일은 먼저 백업.
  2. ~/.claude/settings.json 에 가드 훅(PreToolUse/Bash)만 병합. 다른 설정은 건드리지 않는다. 이미 있으면 중복 추가 안 함.
  3. guard_config.json(운영 서버 주소) 작성 — 이미 있으면 보존, --prod-host 를 주면 갱신.
  4. 가드 시험을 돌려 설치 결과를 확인.
여러 번 실행해도 안전하다(멱등).
"""
import argparse
import datetime
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

KIT = Path(__file__).resolve().parent
PAYLOAD = KIT / "payload"
HOOK_MARK = "hooks/guard.py"
# 이전 버전 키트(에이전트 10개)가 설치했던 파일 — 통합으로 사라졌으므로 백업 후 제거
OBSOLETE = ["agents/dev-architect.md", "agents/dev-area-owner.md", "agents/dev-docs.md",
            "agents/dev-qa.md", "agents/dev-redteam.md", "agents/dev-security.md"]


def posix(p: Path) -> str:
    return str(p).replace("\\", "/")


def payload_files():
    return [p for p in sorted(PAYLOAD.rglob("*")) if p.is_file()]


def plan_copy(target: Path):
    items = []
    for src in payload_files():
        rel = src.relative_to(PAYLOAD)
        dst = target / rel
        if rel.name == "guard_config.json":
            continue   # 설정은 아래에서 따로 처리(보존)
        state = "new" if not dst.exists() else ("same" if dst.read_bytes() == src.read_bytes() else "changed")
        items.append((src, dst, rel, state))
    return items


def merge_settings(target: Path, dry: bool):
    path = target / "settings.json"
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    command = f"python {posix(target / 'hooks' / 'guard.py')}"
    if " " in command.split("python ", 1)[1]:
        command = f'python "{posix(target / "hooks" / "guard.py")}"'
    groups = data.setdefault("hooks", {}).setdefault("PreToolUse", [])
    for g in groups:
        for h in g.get("hooks", []):
            if HOOK_MARK in h.get("command", "").replace("\\", "/"):
                if h.get("command") == command:
                    return "이미 등록됨(변경 없음)", None
                old = h["command"]; h["command"] = command
                if not dry:
                    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                return f"훅 경로 갱신({old} → {command})", path
    groups.append({"matcher": "Bash", "hooks": [{"type": "command", "command": command, "timeout": 10}]})
    if not dry:
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return "가드 훅 등록", path


def write_guard_config(target: Path, hosts, dry: bool):
    path = target / "hooks" / "guard_config.json"
    if path.exists() and not hosts:
        return "보존(기존 설정 유지)"
    new = {"prod_hosts": sorted(set(hosts))}
    if not dry:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(new, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return f"작성 {new}"


def install(target: Path, hosts, dry: bool):
    print(f"설치 위치: {target}" + ("   [dry-run: 파일을 바꾸지 않음]" if dry else ""))
    if not PAYLOAD.exists():
        sys.exit("payload/ 폴더가 없다. 키트가 온전한지 확인하라.")
    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_root = target / "backups-dev-system" / stamp
    counts = {"new": 0, "same": 0, "changed": 0}
    for src, dst, rel, state in plan_copy(target):
        counts[state] += 1
        label = {"new": "추가", "same": "동일(건너뜀)", "changed": "덮어씀(기존 백업)"}[state]
        print(f"  [{label}] {rel}")
        if dry or state == "same":
            continue
        if state == "changed":
            b = backup_root / rel
            b.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(dst, b)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
    for rel in OBSOLETE:
        old = target / rel
        if old.exists():
            print(f"  [제거(통합됨, 백업)] {rel}")
            if not dry:
                b = backup_root / rel
                b.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(old, b)
                old.unlink()
    print("settings.json:", merge_settings(target, dry)[0])
    print("guard_config.json:", write_guard_config(target, hosts, dry))
    print(f"요약: 추가 {counts['new']} / 덮어씀 {counts['changed']} / 동일 {counts['same']}" + (f"  (백업: {backup_root})" if counts["changed"] and not dry else ""))
    if dry:
        return 0
    test = target / "hooks" / "test_guard.py"
    print("\n가드 시험 실행...")
    r = subprocess.run([sys.executable, str(test)], cwd=str(test.parent), capture_output=True, text=True, encoding="utf-8", errors="replace")
    tail = [l for l in r.stdout.splitlines() if l.startswith("cases:")]
    print("  " + (tail[0] if tail else r.stdout[-200:]), "→", "통과" if r.returncode == 0 else "실패!")
    if r.returncode != 0:
        print(r.stdout[-1500:], r.stderr[-500:])
        return 1
    print("\n완료. Claude Code를 새 세션으로 열면 /agents 에 dev-* 에이전트, / 목록에 dev·resume·handover·project-setup 이 보인다.\n프로젝트에서 main 직접 푸시를 허용하려면 그 프로젝트의 .claude/dev-system.json 에 {\"allow_main_push\": true} 를 둔다.")
    return 0


def check(target: Path):
    """설치본이 payload 와 같은지만 확인(파일 변경 없음). 같으면 0, 다르거나 없으면 1."""
    diff = [str(rel) for _, _, rel, state in plan_copy(target) if state != "same"]
    if diff:
        print(f"개발 체계 설치본이 키트와 다름({len(diff)}개): " + ", ".join(diff[:6]) + (" ..." if len(diff) > 6 else ""))
        print("→ python tools/dev-system/install.py  (먼저 --dry-run 가능)")
        return 1
    print("개발 체계: 최신(키트와 동일)")
    return 0


def uninstall(target: Path, dry: bool):
    print(f"제거 위치: {target}" + ("   [dry-run]" if dry else ""))
    for src in payload_files():
        rel = src.relative_to(PAYLOAD)
        dst = target / rel
        if dst.exists():
            print(f"  [삭제] {rel}")
            if not dry:
                dst.unlink()
    path = target / "settings.json"
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        groups = data.get("hooks", {}).get("PreToolUse", [])
        for g in groups:
            g["hooks"] = [h for h in g.get("hooks", []) if HOOK_MARK not in h.get("command", "").replace("\\", "/")]
        data.setdefault("hooks", {})["PreToolUse"] = [g for g in groups if g.get("hooks")]
        if not data["hooks"]["PreToolUse"]:
            data["hooks"].pop("PreToolUse")
        if not data["hooks"]:
            data.pop("hooks")
        print("  [settings.json] 가드 훅 제거")
        if not dry:
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("완료. (백업 폴더 backups-dev-system/ 과 guard_config.json 은 남겨 둠)")
    return 0


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="Claude Code 개발부서 체계 설치기")
    ap.add_argument("--target", help="설치할 .claude 폴더(기본: ~/.claude)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--uninstall", action="store_true")
    ap.add_argument("--check", action="store_true", help="설치본이 키트와 같은지만 확인(변경 없음, 다르면 종료코드 1)")
    ap.add_argument("--prod-host", action="append", default=[], help="운영 서버 주소(여러 번 지정 가능)")
    a = ap.parse_args()
    target = Path(a.target).expanduser().resolve() if a.target else Path.home() / ".claude"
    if a.check:
        sys.exit(check(target))
    sys.exit(uninstall(target, a.dry_run) if a.uninstall else install(target, a.prod_host, a.dry_run))


if __name__ == "__main__":
    main()
