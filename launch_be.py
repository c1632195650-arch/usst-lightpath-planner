import subprocess, os, sys, time

WD = r"D:\WORKBUDDY DATA\学术部\_work_dev"
PY = r"C:\Users\CY\.workbuddy\binaries\python\envs\default\Scripts\python.exe"

# 后端：DETACHED 脱离 agent 进程树，跨会话存活
env = dict(os.environ)
env["PORT"] = "8001"

# 维护批 P0-6（2026-10-11）：stdout/stderr 落盘而非 DEVNULL ——
# 此前后端崩了/被打了一行日志都不剩，事后无法排障与审计入侵（维护计划红旗 S7）。
# 每次启动一个新文件（时间戳命名，不覆盖历史）；_logs/ 命中 .gitignore 的 `_*`
# 规则，不会污染仓库。服务器侧的常驻进程日志由部署脚本另行接管（BLOCKERS 留痕）。
LOG_DIR = os.path.join(WD, "_logs")
os.makedirs(LOG_DIR, exist_ok=True)
_log_path = os.path.join(LOG_DIR, time.strftime("backend-%Y%m%d-%H%M%S.log"))
_log_fh = open(_log_path, "ab", buffering=0)

p = subprocess.Popen(
    [PY, "server/app.py"],
    cwd=WD,
    env=env,
    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS,
    stdout=_log_fh,
    stderr=subprocess.STDOUT,
    close_fds=True,
)
_log_fh.close()  # 子进程已继承句柄，父进程侧即可关闭
print("backend launched pid=%s (detached), log=%s" % (p.pid, _log_path))
sys.stdout.flush()
