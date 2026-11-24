#!/usr/bin/env python3
"""Claude Code PreToolUse(Bash) 가드 — 개인용 개발 체계의 "지침이 아니라 강제" 장치.

stdin으로 훅 JSON(tool_name, tool_input.command)을 받아, 위험한 명령을 막거나(deny) 사용자 확인을 요구한다(ask).
판단 못 하면 아무 출력도 하지 않는다(= 원래 권한 흐름 그대로). 이 스크립트가 오류를 내도 도구 실행을 막지 않도록
모든 예외를 삼키고 exit 0 한다.

막는 것(deny):
  - git push 강제(--force/-f/--force-with-lease), main/master로 푸시
  - git commit/push 의 --no-verify
  - git add -A / --all / '.' (구체적 파일명으로만 스테이징)
  - 시크릿 후보 파일 스테이징(.env, 키/자격증명, config.json, *.db …)
확인을 요구하는 것(ask):
  - 운영 서버(guard_config.json의 prod_hosts)로 가는 scp/rsync, 그리고 쓰기 성격(kill/cp/mv/rm/start.sh/tee/sed -i/pip/systemctl/리다이렉트)이 있는 ssh
  - git reset --hard, git clean -f, git branch -D, git checkout -- <path>(작업 변경 폐기)
"""
import fnmatch
import json
import re
import shlex
import sys

def _load_prod_hosts():
    """운영 서버 주소 목록 — guard.py 옆의 guard_config.json {"prod_hosts": ["1.2.3.4"]}. 없으면 빈 목록(서버 가드 꺼짐)."""
    import os
    try:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "guard_config.json")
        with open(path, encoding="utf-8") as f:
            return [str(h) for h in json.load(f).get("prod_hosts", []) if h]
    except Exception:
        return []


PROD_HOSTS = _load_prod_hosts()
PROTECTED = {"main", "master"}


def load_project_config(cwd):
    """프로젝트별 설정 — 작업 폴더에서 위로 올라가며 .claude/dev-system.json 을 찾는다.
    {"allow_main_push": true, "prod_hosts": ["1.2.3.4"]}
    allow_main_push=true 면 main/master 푸시를 막지 않는다(강제 푸시·--no-verify 등은 계속 막는다).
    없거나 읽기 실패하면 빈 설정(= 가장 엄격한 기본값)."""
    import os
    try:
        d = os.path.abspath(cwd or os.getcwd())
        for _ in range(12):
            path = os.path.join(d, ".claude", "dev-system.json")
            if os.path.isfile(path):
                with open(path, encoding="utf-8") as f:
                    return json.load(f)
            parent = os.path.dirname(d)
            if parent == d:
                break
            d = parent
    except Exception:
        pass
    return {}
SECRET_PATTERNS = [
    ".env", ".env.*", "*.pem", "*.key", "*.p12", "*.pfx", "*credential*", "*serviceaccount*", "*service_account*",
    "config.json", "worker_config.json", "*.db", "*.sqlite", "*.sqlite3", "id_rsa*", "id_ed25519*",
]
SECRET_ALLOW = ["*.example", "*.sample", "*.template"]
SSH_WRITE_HINT = re.compile(
    r"(\bkill\b|\bpkill\b|\bcp\b|\bmv\b|\brm\b|\./start\.sh|nohup|setsid|\btee\b|sed\s+-i|\bpip\d?\s+install|systemctl|\bchmod\b|\bchown\b|>>|[^-]>(?!&)|\bcrontab\b)"
)


def split_segments(command: str):
    """따옴표 밖의 &&, ||, ;, |, 줄바꿈으로 명령을 나눈다. heredoc 본문은 버린다."""
    # heredoc 본문 제거: <<'EOF' ... EOF
    command = re.sub(r"<<-?\s*(['\"]?)(\w+)\1[^\n]*\n.*?\n\s*\2\s*(?=\n|$)", "\n", command, flags=re.S)
    segs, cur, quote, i = [], [], None, 0
    while i < len(command):
        ch = command[i]
        if quote:
            cur.append(ch)
            if ch == "\\" and quote == '"' and i + 1 < len(command):
                cur.append(command[i + 1]); i += 1
            elif ch == quote:
                quote = None
        elif ch in ("'", '"'):
            quote = ch; cur.append(ch)
        elif ch == "\\" and i + 1 < len(command):
            cur.append(ch); cur.append(command[i + 1]); i += 1
        elif command.startswith("&&", i) or command.startswith("||", i):
            segs.append("".join(cur)); cur = []; i += 1
        elif ch in (";", "|", "\n"):
            segs.append("".join(cur)); cur = []
        else:
            cur.append(ch)
        i += 1
    segs.append("".join(cur))
    return [s.strip() for s in segs if s.strip()]


def tokens_of(seg: str):
    try:
        toks = shlex.split(seg, posix=True)
    except ValueError:
        toks = seg.split()
    # 앞의 환경변수 대입(FOO=bar) / command / sudo 제거
    while toks and (re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", toks[0]) or toks[0] in ("command", "sudo", "time")):
        toks = toks[1:]
    return toks


def is_secret(path: str) -> bool:
    name = path.replace("\\", "/").rsplit("/", 1)[-1].lower()
    if any(fnmatch.fnmatch(name, pat) for pat in SECRET_ALLOW):
        return False
    return any(fnmatch.fnmatch(name, pat.lower()) for pat in SECRET_PATTERNS)


def git_subcommand(toks):
    """git [-C dir] [-c k=v] <sub> ... → (sub, args)"""
    i = 1
    while i < len(toks):
        t = toks[i]
        if t in ("-C", "-c", "--git-dir", "--work-tree", "--namespace"):
            i += 2
        elif t.startswith("-"):
            i += 1
        else:
            return t, toks[i + 1:]
    return None, []


def check_git(sub, args, protected=PROTECTED):
    flags = [a for a in args if a.startswith("-")]
    if sub in ("commit", "push") and "--no-verify" in args:
        return "deny", "--no-verify 는 쓰지 않는다(훅/검증 우회 금지)."
    if sub == "push":
        if any(a in ("--force", "-f", "--force-with-lease") or a.startswith("--force-with-lease=") or re.match(r"^-[a-zA-Z]*f[a-zA-Z]*$", a) for a in args):
            return "deny", "강제 푸시는 막혀 있다."
        for a in args:
            if a.startswith("-"):
                continue
            ref = a.split(":", 1)[-1].replace("refs/heads/", "").lstrip("+")
            if ref in protected or a.lstrip("+") in protected:
                return "deny", f"'{ref}' 브랜치로 직접 푸시하지 않는다. 작업 브랜치에서 PR로 병합한다."
        if any(a.startswith("+") for a in args if not a.startswith("-")):
            return "deny", "'+' refspec(강제 갱신)은 막혀 있다."
    if sub == "add":
        if any(a in ("-A", "--all") for a in args) or "." in args or "*" in args:
            return "deny", "git add -A / . / * 는 쓰지 않는다. 구체적인 파일명으로 스테이징한다."
        for a in args:
            if not a.startswith("-") and is_secret(a):
                return "deny", f"시크릿 후보 파일은 스테이징하지 않는다: {a}"
    if sub == "reset" and "--hard" in args:
        return "ask", "git reset --hard 는 작업 변경을 되돌릴 수 없게 버린다."
    if sub == "clean" and any(re.match(r"^-[a-zA-Z]*f", a) or a == "--force" for a in args):
        return "ask", "git clean -f 는 추적 안 되는 파일을 삭제한다."
    if sub == "branch" and any(a in ("-D",) for a in args):
        return "ask", "git branch -D 는 병합 여부와 무관하게 브랜치를 삭제한다."
    if sub in ("checkout", "restore") and ("--" in args or sub == "restore") and "--staged" not in args:
        return "ask", "작업 폴더의 변경을 폐기할 수 있는 명령이다."
    return None


def check_remote(toks, seg, hosts=None):
    prog = toks[0]
    host = next((h for h in (hosts if hosts is not None else PROD_HOSTS) if h in seg), None)
    if not host:
        return None
    if prog in ("scp", "rsync", "sftp"):
        return "ask", f"운영 서버({host})로 파일을 보내는 명령이다 — 배포는 사용자 확인 후에만."
    if prog == "ssh" and SSH_WRITE_HINT.search(seg):
        return "ask", f"운영 서버({host})를 변경할 수 있는 ssh 명령이다 — 배포/재시작은 사용자 확인 후에만."
    return None


def evaluate(command: str, cfg=None):
    cfg = cfg or {}
    protected = set() if cfg.get("allow_main_push") else PROTECTED
    hosts = list(PROD_HOSTS) + [str(h) for h in cfg.get("prod_hosts", []) if h]
    worst = None
    for seg in split_segments(command):
        toks = tokens_of(seg)
        if not toks:
            continue
        result = None
        if toks[0] == "git":
            sub, args = git_subcommand(toks)
            if sub:
                result = check_git(sub, args, protected)
        if result is None:
            result = check_remote(toks, seg, hosts)
        if result:
            if result[0] == "deny":
                return result
            worst = worst or result
    return worst


def main():
    try:
        data = json.loads(sys.stdin.buffer.read().decode("utf-8", errors="replace"))
        if data.get("tool_name") != "Bash":
            return
        command = (data.get("tool_input") or {}).get("command") or ""
        result = evaluate(command, load_project_config(data.get("cwd")))
        if result:
            decision, reason = result
            print(json.dumps({"hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": decision,
                "permissionDecisionReason": f"[개발 체계 가드] {reason}",
            }}))
    except Exception:
        pass


if __name__ == "__main__":
    main()
