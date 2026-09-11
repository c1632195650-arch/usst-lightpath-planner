import os, subprocess, sys, re
sys.stdout.reconfigure(encoding="utf-8")
os.chdir(r"D:\WORKBUDDY DATA\学术部\usst-planner")
GIT = r"C:\Users\CY\.workbuddy\binaries\PortableGit\versions\1.2.0\cmd\git.exe"
GH = r"C:\Program Files\GitHub CLI\gh.exe"
REMOTE = "https://github.com/c1632195650-arch/usst-lightpath-planner.git"
PARENT = "fdbd825f1b1eb422d555bf00b3e4f31a5b1f06bb"
env = dict(os.environ, GIT_TERMINAL_PROMPT="0", APPDATA=r"C:\Users\CY\AppData\Roaming")
env.pop("HTTPS_PROXY", None); env.pop("HTTP_PROXY", None)

def g(*a, **k):
    r = subprocess.run([GIT] + list(a), capture_output=True, text=True,
                       encoding="utf-8", errors="replace", env=env, **k)
    return r.returncode, (r.stdout or ""), (r.stderr or "")

for f in ["_commit_sched.py", "_ship_sched.py"]:
    if os.path.exists(f):
        os.remove(f)
        print("已删", f)
g("config", "user.name", "光溯开发组")
g("config", "user.email", "usst.lightpath@example.com")
g("add", "-A")
print(g("diff", "--cached", "--name-status", PARENT)[1].strip() or "(无变更)")

open("_m.txt", "w", encoding="utf-8").write(
    "chore: 移除误提交的临时脚本\n\n"
    "上一个提交用 git add -A 时把工作用临时脚本 _commit_sched.py 一起提交了。\n"
    "本项目约定：下划线开头的文件是临时工作产物，不进仓库。\n")
_, tree, _ = g("write-tree")
_, commit, _ = g("commit-tree", tree.strip(), "-p", PARENT, "-F", "_m.txt")
commit = commit.strip()
print("COMMIT =", commit)

tok = subprocess.run([GH, "auth", "token"], capture_output=True, text=True,
                     encoding="utf-8", errors="replace", env=env).stdout.strip()
url = REMOTE.replace("https://", f"https://{tok}@")
r = subprocess.run([GIT, "-c", "http.proxy=", "-c", "https.proxy=", "-c", "credential.helper=",
                    "push", url, f"{commit}:refs/heads/main", f"{commit}:refs/heads/dev"],
                   capture_output=True, text=True, encoding="utf-8", errors="replace", env=env, timeout=420)
out = re.sub(r"https://[^@]+@", "https://[TOKEN]@", (r.stdout or "") + (r.stderr or ""))
print("rc =", r.returncode)
print(out[-300:])

# 同步本地 ref，避免本地与远程脱节
g("fetch", "origin", "main")
rc, head, _ = g("rev-parse", "FETCH_HEAD")
if head.strip():
    g("update-ref", "refs/heads/main", head.strip())
    print("本地 HEAD =", g("rev-parse", "--short", "HEAD")[1].strip())
os.remove("_m.txt")
