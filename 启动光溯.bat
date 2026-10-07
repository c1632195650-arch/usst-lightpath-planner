@echo off
rem 启动光溯（本文件必须保持 GBK/ANSI 编码保存，勿转 UTF-8）
rem 2026-10-06 改造：启动前**先构建最新前端**，保证点开运行的就是当前代码（不再是旧 dist）。
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

rem ── 1) 定位 node.exe（本机没有系统级 node，只在 WorkBuddy 私有目录下）──
set "NODE_EXE="
if exist "%USERPROFILE%\.workbuddy\binaries\node\versions" (
  for /d %%D in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do set "NODE_EXE=%%D\node.exe"
)

if exist "%NODE_EXE%" (
  echo [1/2] 正在构建最新前端，约 15 秒，请稍候...
  "%NODE_EXE%" node_modules\vite\bin\vite.js build
  if errorlevel 1 (
    echo [警告] 前端构建失败，将沿用上一次的 dist 产物，界面可能不是最新。
  ) else (
    echo [1/2] 前端构建完成，已是最新版本。
  )
) else (
  echo [警告] 没找到 node.exe，跳过构建，直接使用现有 dist。
  echo         期望位置：C:\Users\xulan\.workbuddy\binaries\node\versions\*\node.exe
)

rem ── 2) 启动服务（8000；若已有实例在跑则直接复用，避免端口冲突）──
netstat -ano | findstr "LISTENING" | findstr ":8000" >nul
if not errorlevel 1 (
  echo [提示] 8000 端口已有实例在运行，直接打开浏览器即可。
  echo         该实例读盘即取，会自动显示刚刚构建出来的最新版本。
  start "" http://127.0.0.1:8000
  timeout /t 2 /nobreak >nul
  exit /b 0
)

rem 浏览器延迟 2 秒再开，等 serve.py 就绪
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:8000"
title 光溯 - 服务运行中（关闭本窗口=停止服务）
".venv\Scripts\python.exe" serve.py
pause
