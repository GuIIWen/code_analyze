@echo off
setlocal enabledelayedexpansion

echo ==================================================
echo       研发效能深度分析看板 - 启动程序
echo ==================================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo 未检测到 Node.js。请先下载并安装 Node.js (https://nodejs.org/)
    pause
    exit /b
)

if not exist node_modules\ (
    echo 首次运行，正在安装项目依赖，请稍候...
    call npm install
)

echo.
echo 正在启动本地服务器并允许局域网访问 (0.0.0.0)...

for /f "tokens=2 delims=:" %%i in ('ipconfig ^| findstr /i "IPv4"') do (
    set "local_ip=%%i"
    set "local_ip=!local_ip: =!"
    echo 局域网其他同事可通过此地址访问: http://!local_ip!:3000
)

echo.
echo 启动成功后将自动在您的浏览器中打开。
echo 如需停止服务，请按 Ctrl+C 或直接关闭此窗口。
echo.

call npm run dev
pause
