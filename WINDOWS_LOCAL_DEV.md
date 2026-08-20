# Windows 本地开发测试指南（VS Code）

本文档说明如何在 Windows 本地使用 VS Code 运行和测试项目。

---

## 一、环境准备

### 1. 安装 Node.js 22.x

```powershell
# 使用 nvm-windows 安装（推荐）
# 下载地址：https://github.com/coreybutler/nvm-windows/releases

# 安装 nvm 后，打开 PowerShell
nvm install 22.11.0
nvm use 22.11.0

# 验证安装
node --version  # 应显示 v22.x.x
npm --version   # 应显示 10.x.x
```

或者直接从官网下载安装：https://nodejs.org/zh-cn/download/

### 2. 安装 VS Code 插件

打开 VS Code，安装以下插件：

1. **ESLint** - 代码检查
2. **Prettier** - 代码格式化
3. **TypeScript Importer** - 自动导入
4. **Tailwind CSS IntelliSense** - CSS 提示
5. **Error Lens** - 错误显示
6. **Path Intellisense** - 路径提示

### 3. 克隆项目

```powershell
# 进入你的工作目录
cd C:\\Projects

# 克隆项目（如果使用 git）
git clone <your-repo-url> jingji-training-monitor

# 或者解压项目文件
cd jingji-training-monitor
```

---

## 二、项目配置

### 1. 安装依赖

```powershell
# 在项目根目录打开 PowerShell
npm install

# 如果安装慢，使用淘宝镜像
npm config set registry https://registry.npmmirror.com
npm install
```

### 2. 配置环境变量

创建 `.env` 文件在项目根目录：

```env
# ============================================
# Windows 本地开发环境配置
# ============================================

# 服务器端口
PORT=8787

# 数据库路径（Windows 绝对路径，使用正斜杠或双反斜杠）
DATABASE_PATH=C:/Projects/jingji-training-monitor/data/training-monitor.db
# 或 DATABASE_PATH=C:\\Projects\\jingji-training-monitor\\data\\training-monitor.db

# JWT 密钥（本地测试用，生产环境必须修改）
JWT_SECRET=your-local-dev-secret-key-123456789

# 运动员照片存储目录
ATHLETE_PHOTO_ROOT=C:/Projects/jingji-training-monitor/data/uploads/athlete-photos

# AI 配置（阿里云百炼 OpenAI 兼容接口）
AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
AI_API_KEY=
AI_MODEL=qwen3.7-plus

# 时区
TZ=Asia/Shanghai
```

### 3. 创建必要目录

```powershell
# PowerShell 中执行
New-Item -ItemType Directory -Force -Path "data/uploads/athlete-photos"
New-Item -ItemType Directory -Force -Path "logs"
```

---

## 三、VS Code 运行配置

### 1. 创建调试配置

在 `.vscode/launch.json` 中添加：

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "启动后端服务",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "npx",
      "runtimeArgs": ["tsx", "watch", "server/index.ts"],
      "env": {
        "NODE_ENV": "development"
      },
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    },
    {
      "name": "启动前端开发服务器",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev:web"],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    }
  ],
  "compounds": [
    {
      "name": "同时启动前后端",
      "configurations": ["启动后端服务", "启动前端开发服务器"],
      "stopAll": true
    }
  ]
}
```

### 2. 创建任务配置

在 `.vscode/tasks.json` 中添加：

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "安装依赖",
      "type": "shell",
      "command": "npm install",
      "group": "build"
    },
    {
      "label": "启动开发服务器",
      "type": "shell",
      "command": "npm run dev",
      "group": {
        "kind": "build",
        "isDefault": true
      }
    },
    {
      "label": "构建前端",
      "type": "shell",
      "command": "npm run build",
      "group": "build"
    },
    {
      "label": "类型检查",
      "type": "shell",
      "command": "npm run check",
      "group": "test"
    }
  ]
}
```

---

## 四、运行项目

### 方式一：使用 VS Code 调试（推荐）

1. 按 `F5` 或点击左侧调试图标
2. 选择 **"同时启动前后端"**
3. 等待启动完成
4. 访问 http://localhost:5173

### 方式二：使用终端

```powershell
# 在项目根目录，打开两个 PowerShell 窗口

# 窗口 1：启动后端
npm run dev:server

# 窗口 2：启动前端
npm run dev:web

# 然后访问 http://localhost:5173
```

### 方式三：同时启动（最简单）

```powershell
npm run dev
```

这会同时启动前端（5173）和后端（8787）。

---

## 五、本地测试 AI 功能

### 1. 如果你有阿里云百炼 API 密钥

直接在 `.env` 中配置：
```env
AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
AI_API_KEY=在这里填写百炼API密钥
AI_MODEL=qwen3.7-plus
```

密钥从阿里云百炼控制台获取。不要把真实 API 密钥提交到 Git。

### 2. 如果没有 API 密钥（使用模拟数据）

修改 `server/ai-service.ts`，添加模拟模式：

```typescript
// 在 generateTrainingPlan 方法开头添加
async generateTrainingPlan(...) {
  // 本地测试模式：如果没有配置 API，返回模拟数据
  if (this.models.length === 0) {
    console.log('[AI] 使用本地模拟数据');
    return this.getMockTrainingPlan(context);
  }
  // ... 原有代码
}

// 添加模拟数据方法
private getMockTrainingPlan(context: AthleteContext): AIGenerationResult {
  return {
    plan: {
      title: `${context.athlete.name}的四周力量训练计划（测试数据）`,
      summary: `为${context.athlete.name}生成的测试训练计划。周期：4周，重点：上肢和下肢力量提升。`,
      durationWeeks: 4,
      startDate: new Date().toISOString().split('T')[0],
      endDate: new Date(Date.now() + 28 * 86400000).toISOString().split('T')[0],
      scheduleLabel: '周二/周四/周六',
      bodyWeight: null,
      age: null,
      weeklyPlans: [
        {
          weekNumber: 1,
          focus: '基础适应期，建立动作模式',
          totalLoad: 75,
          days: [
            {
              dayOfWeek: '周二',
              exercises: [
                { name: '卧拉', sets: '4', reps: '8', percentage: 70 },
                { name: '深蹲', sets: '3', reps: '10', percentage: 65 }
              ]
            },
            {
              dayOfWeek: '周四',
              exercises: [
                { name: '卧推', sets: '4', reps: '8', percentage: 70 },
                { name: '硬拉', sets: '3', reps: '6', percentage: 70 }
              ]
            },
            {
              dayOfWeek: '周六',
              exercises: [
                { name: '高拉', sets: '4', reps: '8', percentage: 65 },
                { name: '弓步蹲', sets: '3', reps: '12', percentage: 60 }
              ]
            }
          ]
        }
        // ... 更多周数据
      ],
      exercises: [
        { id: '1', name: '卧拉', maxWeight: 65, unitNote: '20' },
        { id: '2', name: '卧推', maxWeight: 60, unitNote: '20' },
        { id: '3', name: '深蹲', maxWeight: 80, unitNote: '20' },
        { id: '4', name: '硬拉', maxWeight: 90, unitNote: '20' }
      ],
      aiModel: 'mock-local'
    },
    modelUsed: '本地模拟',
    attempts: 1
  };
}
```

---

## 六、常见问题

### 1. 端口被占用

```powershell
# 查找占用 8787 端口的进程
Get-Process -Id (Get-NetTCPConnection -LocalPort 8787).OwningProcess

# 结束进程
Stop-Process -Id <PID>
```

### 2. 数据库权限错误

```powershell
# 确保目录有写入权限
# 右键 data 文件夹 -> 属性 -> 安全 -> 编辑 -> 添加 -> Everyone -> 完全控制
```

### 3. tsx 命令找不到

```powershell
# 全局安装 tsx
npm install -g tsx

# 或在项目本地使用 npx
npx tsx server/index.ts
```

### 4. 文件上传失败

确保 `data/uploads/athlete-photos` 目录存在且有写入权限。

### 5. 热更新不生效

```powershell
# 重启前端服务
# 按 Ctrl+C 停止，然后重新运行
npm run dev:web
```

---

## 七、生产环境部署前检查

本地测试完成后，部署前请修改：

1. **修改 JWT_SECRET** - 使用强密钥
2. **修改数据库路径** - 改为 Linux 路径格式
3. **配置真实的 AI API 密钥**
4. **修改 ATHLETE_PHOTO_ROOT** - 改为 Linux 绝对路径

```bash
# 部署前检查清单
JWT_SECRET=$(openssl rand -hex 48)
DATABASE_PATH=/app/jingji/data/training-monitor.db
ATHLETE_PHOTO_ROOT=/app/jingji/data/uploads/athlete-photos
```

---

## 八、VS Code 快捷键

| 快捷键 | 功能 |
|--------|------|
| `F5` | 启动调试 |
| `Ctrl+Shift+B` | 运行构建任务 |
| `Ctrl+`` ` | 打开/关闭终端 |
| `Ctrl+P` | 快速打开文件 |
| `Ctrl+Shift+F` | 全局搜索 |
| `F12` | 跳转到定义 |
| `Alt+Click` | 多光标编辑 |

---

## 九、推荐工作流

1. **启动开发**：`F5`（同时启动前后端）
2. **编码**：修改代码，保存后自动热更新
3. **调试**：在代码中点击行号左侧添加断点
4. **查看日志**：在 VS Code 终端查看输出
5. **测试 API**：使用 Thunder Client 或 Postman

访问地址：
- 前端：http://localhost:5173
- 后端 API：http://localhost:8787
