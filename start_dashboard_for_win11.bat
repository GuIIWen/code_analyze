@echo off
:: 1. 切换编码以支持中文显示
chcp 65001 >nul
setlocal enabledelayedexpansion

:: 2. 强制进入脚本所在目录，处理 Win11 中复杂的右键启动路径问题
cd /d "%~dp0"

echo ==================================================
echo       研发效能深度分析看板 - Win11 专用启动器 (v2.0)
echo       集成 AI 智能分析与多维工程汇总
echo ==================================================
echo.

:: 3. 检查 Node.js 环境
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [错误] 未检测到 Node.js。请先安装 Node.js (https://nodejs.org/)
    pause
    exit /b
)

:: 4. 依赖自动安装与检查
if not exist node_modules\ (
    echo [状态] 首次运行，正在为您自动安装项目依赖，请稍候...
    call npm install
) else (
    echo [状态] 运行环境已就绪。
)

echo.
echo [状态] 正在启动看板服务，并允许局域网共享访问...

:: 5. 获取并提示局域网 IP (Win11 兼容方式)
for /f "tokens=2 delims=:" %%i in ('ipconfig ^| findstr /i "IPv4"') do (
    set "local_ip=%%i"
    set "local_ip=!local_ip: =!"
    echo [提示] 局域网同事可通过此地址访问: http://!local_ip!:3000
)

echo.
echo [提示] 启动成功后将自动在您的浏览器中打开。
echo [提示] 如需人员合并，请编辑根目录下的 author_mapping.json。
echo.

:: 6. 执行启动
call npm run dev
pause
