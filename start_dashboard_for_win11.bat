@echo off
:: 1. 放在最前面，确保后续输出不乱码
chcp 65001 >nul

:: 2. 这里的双引号是处理“开发”路径的关键
cd /d "%~dp0"

echo ==================================================
echo        研发效能深度分析看板 - Win11 专用启动器
echo ==================================================

:: 3. 检查 Node.js (改用更稳妥的 errorlevel 判断，避开 if 括号)
node -v >nul 2>&1
if errorlevel 1 goto NO_NODE

:: 4. 检查 node_modules (避开 if (...) 嵌套，改用 goto)
if exist "node_modules\" goto START_DEV
echo [状态] 首次运行，正在为您自动安装项目依赖...
:: 考虑到你之前的证书报错，这里建议带上关闭校验
call npm install --strict-ssl=false

:START_DEV
echo.
echo [状态] 正在启动看板服务...

:: 5. 获取 IP (保留此功能，但简化逻辑防止崩溃)
for /f "tokens=2 delims=:" %%i in ('ipconfig ^| findstr /i "IPv4"') do (
    set "ip=%%i"
    set "ip=!ip: =!"
)
echo [提示] 局域网访问地址: http://%ip%:3000

echo.
call npm run dev
pause
exit /b

:NO_NODE
echo [错误] 未检测到 Node.js。请先安装: https://nodejs.org/
pause
exit /b