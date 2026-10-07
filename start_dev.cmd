@echo off
chcp 65001 >nul
cd /d "D:\WORKBUDDY DATA\学术部\_work_dev"

echo ============================================================
echo  usst-planner 开发环境一键启动
echo  - 后端: PORT=8001 (避开被占用的 8000，那是要给别人的，别杀)
echo  - 前端: 5173, VITE_API_BASE 指向 8001 后端
echo  关闭: 直接关掉弹出的两个黑窗口即可
echo ============================================================

rem ---- 启动前检测：8001 是否已有实例（防止 WinError 10048 假性「后端起不来」）----
set "OLD_PID="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /C:":8001 " ^| findstr /C:"LISTENING"') do set "OLD_PID=%%P"
if not defined OLD_PID goto be_start

powershell -NoProfile -Command "try{Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8001/api/health' -TimeoutSec 3 | Out-Null; exit 0}catch{exit 1}"
if errorlevel 1 goto be_stale_port

echo [i] 8001 上已有健康的梨宝后端（PID %OLD_PID%），本次直接复用，不再新起后端窗口。
echo     若刚改过后端代码、想让改动生效，请先结束旧实例再重跑本脚本：
echo       taskkill /PID %OLD_PID% /F
goto be_done

:be_stale_port
echo [!] 8001 被进程 PID %OLD_PID% 占用，但 /api/health 无响应（疑似僵死实例）。
choice /C YN /T 15 /D N /M "强制结束该进程并继续启动?"
if errorlevel 2 (
    echo 已取消。可手动处理后重跑本脚本：taskkill /PID %OLD_PID% /F
    pause
    exit /b 1
)
taskkill /PID %OLD_PID% /F >nul 2>&1
timeout /t 2 /nobreak >nul

:be_start
rem 后端：开一个独立窗口，绑定 8001
start "usst-backend" cmd /k "set PORT=8001 & C:\Users\CY\.workbuddy\binaries\python\envs\default\Scripts\python.exe server/app.py"

:be_done
rem 前端：开一个独立窗口，API 指向 8001 后端
start "usst-frontend" cmd /k "set VITE_API_BASE=http://127.0.0.1:8001 & C:\Users\CY\.workbuddy\binaries\node\versions\24.14.0\npm.cmd run dev"

rem 前端起得快（约 5 秒）；后端要加载向量模型（实测 30~90 秒），就绪后再开 /docs
echo 前端窗口已启动，8 秒后打开前端页面...
timeout /t 8 /nobreak >nul
start "" http://127.0.0.1:5173

echo 等待后端就绪（加载向量模型，最长约 2 分钟）...
powershell -NoProfile -Command "for($i=0;$i -lt 60;$i++){try{Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:8001/api/health' -TimeoutSec 2 | Out-Null; exit 0}catch{Start-Sleep -Seconds 2}}; exit 1"
if errorlevel 1 echo [!] 后端 120 秒内未就绪，稍后手动访问 http://127.0.0.1:8001/docs
if not errorlevel 1 start "" http://127.0.0.1:8001/docs

echo 两个窗口已启动。前端 http://127.0.0.1:5173  后端 http://127.0.0.1:8001/docs
pause
