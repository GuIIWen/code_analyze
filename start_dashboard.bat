@echo off
setlocal enabledelayedexpansion

echo ==================================================
echo       研发效能深度分析看板 - 启动程序 (v2.0)
echo       集成 AI 智能分析与多维工程汇总
echo ==================================================
echo.

:: 1. 环境检查
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [错误] 未检测到 Node.js。请先安装 Node.js (https://nodejs.org/)
    pause
    exit /b
)

:: 2. 依赖自动安装
if not exist node_modules\ (
    echo [状态] 首次运行，正在自动安装项目依赖，请稍候...
    call npm install
)

echo.
echo [状态] 正在启动看板服务，并允许局域网共享访问...

:: 3. 获取并提示局域网 IP
for /f "tokens=2 delims=:" %%i in ('ipconfig ^| findstr /i "IPv4"') do (
    set "local_ip=%%i"
    set "local_ip=!local_ip: =!"
    echo [提示] 局域网同事可通过此地址访问: http://!local_ip!:3000
)

echo.
echo [提示] 启动成功后将自动在您的浏览器中打开。
echo [提示] 默认已按文件夹归类工程，请检查根目录下的数据文件夹。
echo [提示] 如需人员合并，请编辑 author_mapping.json。
echo.

:: 4. 执行启动
call npm run dev
pause
