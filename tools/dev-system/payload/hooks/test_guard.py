"""guard.py 시험: python ~/.claude/hooks/test_guard.py"""
import json, os, subprocess, sys, tempfile
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, ".")
import guard
guard.PROD_HOSTS = ["203.0.113.10"]   # 시험용 고정(설정 파일과 무관하게)
cases = [
 ("git push -u origin docs/handoff-and-main-sync", None), ("git push origin feature/bulk-queue", None),
 ("git push origin main", "deny"), ("git push origin HEAD:main", "deny"), ("git push origin HEAD:refs/heads/master", "deny"),
 ("git push --force origin feat/x", "deny"), ("git push -f", "deny"), ("git push --force-with-lease origin feat/x", "deny"),
 ("git push origin +feat/x", "deny"), ("git push origin prod-20261105-1537", None), ("git push origin --tags", None),
 ("git commit --no-verify -m x", "deny"), ("git commit -m 'mention --no-verify in text'", None),
 ("git add -A", "deny"), ("git add .", "deny"), ("git add CLAUDE.md docs tests HANDOFF.md", None),
 ("git add .env", "deny"), ("git add config.json", "deny"), ("git add config.json.example", None),
 ("git add backend/credentials/serviceAccount.json", "deny"), ("git add portal.db", "deny"),
 ("git -C /x add -A", "deny"), ("cd repo && git add -A && git commit -m x", "deny"),
 ("git reset --hard HEAD~1", "ask"), ("git reset --soft HEAD~1", None), ("git clean -fd", "ask"),
 ("git branch -D old", "ask"), ("git branch -d old", None), ("git checkout -- file.py", "ask"), ("git checkout -b feature/x", None),
 ("git status && git log --oneline -3", None),
 ("scp -P 20022 a.py deploy@203.0.113.10:apps/app/a.py", "ask"),
 ("ssh -p 20022 deploy@203.0.113.10 'ps aux | grep uvicorn; curl -s http://127.0.0.1:8000/health'", None),
 ("ssh -p 20022 deploy@203.0.113.10 'cd ~/apps/app && cp main.py main.py.bak'", "ask"),
 ("ssh -p 20022 deploy@203.0.113.10 \"pgrep -f x | xargs -r kill\"", "ask"),
 ("ssh -p 20022 deploy@203.0.113.10 'tail -n 25 ~/apps/app/app.log'", None),
 ("ssh -p 20022 deploy@203.0.113.10 'cat start.sh'", None),
 ("ssh -p 20022 deploy@203.0.113.10 \"cd ~/apps/app && (setsid nohup ./start.sh >> app.log 2>&1 < /dev/null &)\"", "ask"),
 ("ls -la && echo hi", None),
 ("git commit -F - <<'EOF'\nAdd things\n\ngit add -A is forbidden\nEOF", None),
 ("python -c \"print('git push --force')\"", None), ("echo 'git push origin main'", None),
 ("git commit -m \"한글 메시지 — 테스트\"", None),
]
bad = 0
for cmd, exp in cases:
    r = guard.evaluate(cmd); got = r[0] if r else None
    if got != exp:
        bad += 1; print("FAIL", repr(cmd[:90]), "expected", exp, "got", got)
print(f"cases: {len(cases)}  failures: {bad}")
# 프로젝트 설정(.claude/dev-system.json) 시험
cfg_cases = [
 ("git push origin main", {"allow_main_push": True}, None),
 ("git push --force origin main", {"allow_main_push": True}, "deny"),
 ("git push origin HEAD:main", {"allow_main_push": True}, None),
 ("git commit --no-verify -m x", {"allow_main_push": True}, "deny"),
 ("git add -A", {"allow_main_push": True}, "deny"),
 ("git push origin main", {}, "deny"),
 ("scp a.py me@198.51.100.7:/x", {"prod_hosts": ["198.51.100.7"]}, "ask"),
]
for cmd, cfg, exp in cfg_cases:
    r = guard.evaluate(cmd, cfg); got = r[0] if r else None
    if got != exp:
        bad += 1; print("FAIL cfg", repr(cmd[:90]), cfg, "expected", exp, "got", got)
print(f"cfg cases: {len(cfg_cases)}  total failures: {bad}")
_TMP = tempfile.mkdtemp()   # 설정 파일이 없는 폴더(저장소 안의 설정이 시험에 섞이지 않게)
d = os.path.join(_TMP, ".claude"); os.makedirs(d)
with open(os.path.join(d, "dev-system.json"), "w", encoding="utf-8") as f:
    json.dump({"allow_main_push": True}, f)
sub = os.path.join(_TMP, "a", "b"); os.makedirs(sub)
print("config found upward:", guard.load_project_config(sub) == {"allow_main_push": True}, "| none:", guard.load_project_config(tempfile.gettempdir()) == {} or "(상위에 설정 있음)")
def run(inp, raw=False):
    return subprocess.run([sys.executable, "guard.py"], input=(inp if raw else json.dumps(inp, ensure_ascii=False)).encode("utf-8"), capture_output=True)
p = run({"tool_name": "Bash", "cwd": tempfile.gettempdir(), "tool_input": {"command": "git push origin main"}}); print("e2e deny:", p.returncode, p.stdout.decode()[:120])
p = run({"tool_name": "Bash", "cwd": tempfile.gettempdir(), "tool_input": {"command": "echo 한글 && git add -A"}}); print("e2e korean+deny:", p.returncode, '"deny"' in p.stdout.decode())
p = run("garbage", raw=True); p2 = run({"tool_name": "Bash", "cwd": sub, "tool_input": {"command": "git push origin main"}}); print("e2e project allow_main_push:", p2.returncode, repr(p2.stdout.decode()))
print("garbage:", p.returncode, repr(p.stdout))
p = run({"tool_name": "Read", "tool_input": {}}); print("non-bash:", p.returncode, repr(p.stdout))
sys.exit(1 if bad else 0)
