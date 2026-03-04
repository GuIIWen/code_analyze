@echo off
:: 1. 切换编码
chcp 65001 >nul

:: 2. 强制进入脚本所在目录 (处理中文路径的关键：加双引号)
d:
cd /d "%~dp0"

echo ==================================================
echo         研发效能深度分析看板 - 启动程序
echo ==================================================

:: 3. 简单的 Node 检查
node -v >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装。
    pause
    exit /b
)

:: 4. 依赖安装 (跳过复杂的 if 文件夹判断，直接交给 npm)
:: 如果 node_modules 已存在，npm install 会很快扫描完
echo [INFO] 正在检查环境依赖...
call npm install --strict-ssl=false

:: 5. 启动服务
echo [INFO] 正在启动开发服务器...
echo [提示] 如果是局域网访问，请确认防火墙已开启 3000 端口。
echo.

call npm run dev

pause