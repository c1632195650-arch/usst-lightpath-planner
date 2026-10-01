import subprocess, os, sys

WD = r"D:\WORKBUDDY DATA\学术部\_work_dev"
PY = r"C:\Users\CY\.workbuddy\binaries\python\envs\default\Scripts\python.exe"

# 后端：DETACHED 脱离 agent 进程树，跨会话存活
env = dict(os.environ)
env["PORT"] = "8001"

p = subprocess.Popen(
    [PY, "server/app.py"],
    cwd=WD,
    env=env,
    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    close_fds=True,
)
print("backend launched pid=%s (detached)" % p.pid)
sys.stdout.flush()
