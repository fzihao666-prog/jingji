@echo off
chcp 65001 >nul
echo ==========================================
echo   竞迹训练监控平台 - Windows 本地启动脚本
echo ==========================================
echo.

:: 检查 Node.js 版本
echo [1/4] 检查 Node.js 版本...
node --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未找到 Node.js，请先安装 Node.js 22.x
    echo 下载地址：https://nodejs.org/
    pause
    exit /b 1
)

for /f "tokens=1,* delims=v" %%a in ('node --version') do set NODE_VERSION=%%a
echo [OK] Node.js 版本: %NODE_VERSION%

:: 检查 .env 文件
echo.
echo [2/4] 检查环境变量配置...
if not exist ".env" (
    echo [警告] 未找到 .env 文件，将使用 .env.example 创建
    if exist ".env.example" (
        copy ".env.example" ".env"
        echo [OK] 已创建 .env 文件，请编辑配置后重新运行
        notepad ".env"
        pause
        exit /b 1
    ) else (
        echo [错误] 未找到 .env.example 文件
        pause
        exit /b 1
    )
)
echo [OK] .env 文件已存在

:: 检查依赖
echo.
echo [3/4] 检查项目依赖...
if not exist "node_modules" (
    echo [信息] 未找到 node_modules，开始安装依赖...
    npm install
    if errorlevel 1 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
) else (
    echo [OK] 依赖已安装
)

:: 创建必要目录
echo.
echo [4/4] 检查数据目录...
if not exist "data" mkdir data
if not exist "data\\uploads" mkdir data\\uploads
if not exist "data\\uploads\\athlete-photos" mkdir data\\uploads\\athlete-photos
if not exist "logs" mkdir logs
echo [OK] 目录检查完成

:: 启动服务
echo.
echo ==========================================
echo   启动开发服务器...
echo ==========================================
echo.
echo 前端将运行在: http://localhost:5173
echo 后端将运行在: http://localhost:8787
echo.
echo 按 Ctrl+C 停止服务
echo.

npm run dev

pause
