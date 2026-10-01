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

rem 等服务起来，再自动打开浏览器（后端加载向量模型较慢，若 /docs 打不开等几秒刷新即可）
echo 等待 10 秒让服务就绪，然后自动打开浏览器...
timeout /t 10 /nobreak >nul
start "" http://127.0.0.1:5173
start "" http://127.0.0.1:8001/docs

echo 已启动两个窗口并打开浏览器:
echo   前端  http://127.0.0.1:5173
echo   后端  http://127.0.0.1:8001/docs
pause
