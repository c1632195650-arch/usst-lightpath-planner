@echo off
rem 启动光溯（本文件必须保持 GBK/ANSI 编码保存，勿转 UTF-8）
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
rem 浏览器延迟 2 秒再开，等 serve.py 就绪
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:8000"
title 光溯 - 服务运行中（关闭本窗口=停止服务）
".venv\Scripts\python.exe" serve.py
pause
