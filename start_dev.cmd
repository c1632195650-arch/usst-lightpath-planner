@echo off
chcp 65001 >nul
cd /d "D:\WORKBUDDY DATA\学术部\_work_dev"

echo ============================================================
echo  usst-planner 开发环境一键启动
echo  - 后端: PORT=8001 (避开被占用的 8000，那是要给别人的，别杀)
echo  - 前端: 5173, VITE_API_BASE 指向 8001 后端
echo  关闭: 直接关掉弹出的两个黑窗口即可
echo ============================================================

rem 后端：开一个独立窗口，绑定 8001
start "usst-backend" cmd /k "set PORT=8001 & C:\Users\CY\.workbuddy\binaries\python\envs\default\Scripts\python.exe server/app.py"

rem 前端：开一个独立窗口，API 指向 8001 后端
start "usst-frontend" cmd /k "set VITE_API_BASE=http://127.0.0.1:8001 & C:\Users\CY\.workbuddy\binaries\node\versions\22.22.2-3\npm.cmd run dev"

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
