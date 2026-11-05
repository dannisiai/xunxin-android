@echo off
chcp 65001 >nul
title AI 虚拟手机 (AI Virtual Phone)
cd /d "%~dp0"

echo =======================================================
echo          正在启动 AI 虚拟手机 (AI Virtual Phone)
echo =======================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js (推荐 20+): https://nodejs.org/
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo [提示] 正在自动执行 npm install...
    call npm install
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败，请检查网络后重试。
        pause
        exit /b 1
    )
)

if not exist ".env.local" (
    if exist ".env.example" (
        copy ".env.example" ".env.local" >nul
    )
)

echo [提示] 正在启动 Next.js 本地开发服务...
echo [提示] 访问地址: http://localhost:3001
echo.

start "" powershell -NoProfile -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:3001'"
npm run dev

pause
