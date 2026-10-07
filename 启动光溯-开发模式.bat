@echo off
rem 启动光溯 · 开发模式（本文件必须保持 GBK/ANSI 编码保存，勿转 UTF-8）
rem 2026-10-06 新增：改 UI 时用。前端跑 Vite dev（5173，改代码即时刷新，不用等构建）；
rem   后端仍由 serve.py 提供（8000）；Vite 已配好把 /api、/timetable 代理到 8000。
setlocal
cd /d "C:\Users\xulan\WorkBuddy\上理生活助手\usst-lightpath-planner"

if not exist "serve.py" (
  echo [错误] 没找到 serve.py，请确认仓库目录完整
  pause
  exit /b 1
)
if not exist ".venv\Scripts\python.exe" (
  echo [错误] 没找到项目虚拟环境 .venv，请重新初始化
  pause
  exit /b 1
)

rem ── 定位 node.exe ──
set "NODE_EXE="
if exist "%USERPROFILE%\.workbuddy\binaries\node\versions" (
  for /d %%D in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do set "NODE_EXE=%%D\node.exe"
)
if not exist "%NODE_EXE%" (
  echo [错误] 没找到 node.exe，无法启动 dev 服务。
  echo         期望位置：C:\Users\xulan\.workbuddy\binaries\node\versions\*\node.exe
  pause
  exit /b 1
)

rem ── 1) 后端 8000：没在跑就另开一个窗口起 ──
netstat -ano | findstr "LISTENING" | findstr ":8000" >nul
if errorlevel 1 (
  echo [1/2] 启动后端 serve.py（新窗口，端口 8000）...
  start "光溯-后端8000" cmd /k ".venv\Scripts\python.exe serve.py"
) else (
  echo [1/2] 8000 后端已在运行，直接复用。
)

rem ── 2) 前端 dev 5173（关掉本窗口 = 停止前端）──
echo [2/2] 启动前端 dev 服务（5173，热更新）...
start "" /min cmd /c "timeout /t 5 /nobreak >nul & start http://127.0.0.1:5173"
title 光溯 - 开发模式 5173（关闭本窗口=停止前端）
"%NODE_EXE%" node_modules\vite\bin\vite.js --host 127.0.0.1 --port 5173 --strictPort
pause
