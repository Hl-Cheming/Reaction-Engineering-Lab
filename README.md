# 反应工程智能求解器 V1.6

用于反应工程课堂演示、习题计算与作业核对的交互式辅助工具。它不是完整在线教材，主流程为：

> 定义组分与反应 → 配置物流和反应器 → 确认计算规格 → 查看答案、曲线与依据

当前支持 BR、CSTR、PFR、PBR，以及最多 8 个组分、8 条反应组成的动态反应集合。V1.6 采用弹窗式案例配置，并已闭合组分—反应—物流—反应器—规格—运行流程：五类对象分别校验就绪状态，入口采用统一摩尔物流对象，案例可自动保存、导入、导出和创建副本。数值求解器和容差收纳在高级选项。

版本变化详见 [`版本说明.md`](./版本说明.md)；Bug 修复记录详见 [`修复日志.md`](./修复日志.md)；各版本的数学原理与实现路径见 `版本原理/` 下的 `v1.0.md` 至 `v1.6.md`。

项目不依赖 Sites、Cloudflare 或 vinext；公开版本使用仓库内置的 GitHub Pages 工作流部署。

## 在线版本与数据说明

[在线访问反应工程智能求解器](https://darken-lv.github.io/Reaction-Engineering-Lab/)

项目可作为纯静态网站部署。当前主要计算、案例自动保存以及案例文件的导入导出均在浏览器中完成，公开网页不需要启动 Python API，也不会主动把案例数据上传到服务器。浏览器自动保存的数据仅保存在当前设备中；清除站点数据后可能丢失，请及时导出重要案例。

当前仓库尚未声明开源许可证；公开可见不等同于授权他人复制、修改或再分发。维护者后续仍需补充项目负责人和许可证信息。

## 启动前端

需要 Node.js 20.19+ 或 22.12+。

```powershell
npm install
npm run dev
```

打开 `http://127.0.0.1:5173`。

## 部署到 GitHub Pages

仓库已包含 `.github/workflows/deploy-pages.yml`。工作流会在 `main` 分支更新后自动安装依赖、运行前端测试、生成生产版本并发布 `dist`。它会根据仓库名称自动设置 Vite 的站点路径，因此普通项目站点和 `<用户名>.github.io` 根站点都可使用同一套配置。

首次发布需要在 GitHub 仓库中完成以下设置：

1. 打开 `Settings → Pages`。
2. 在 `Build and deployment` 下将 `Source` 选择为 `GitHub Actions`。
3. 推送 `main` 分支，或在 `Actions` 页面手动运行 `Deploy to GitHub Pages`。
4. 部署成功后，把生成的公开网址补充到本 README。

若以后绑定自定义域名，可在 GitHub Pages 设置中配置域名，并在仓库的 Actions Variables 中把 `VITE_BASE_PATH` 设为 `/`。

## 启动 Python API

Python API 是可选的教学基线与接口示例，当前静态网页不会调用它。

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

API 文档：`http://127.0.0.1:8000/docs`。

## 校验

```powershell
npm run build
python -m unittest discover -s backend\tests -v
```

提交到 `main` 后，GitHub Pages 工作流会自动执行前端测试与生产构建。Python 测试仍需在安装了后端依赖的本地或单独的持续集成环境中执行。

一级 BR、CSTR、PFR 解析解误差验收限为 `1×10⁻⁶`；现有测试按 12 位小数比较。

## 项目结构

```text
reaction-lab/
├─ index.html                  # Vite 页面模板与前端挂载节点
├─ package.json                # 前端依赖及 dev、build、preview、typecheck 脚本
├─ package-lock.json           # npm 依赖版本锁定文件，保证安装结果可复现
├─ tsconfig.json               # TypeScript 编译规则与类型检查配置
├─ vite.config.ts              # Vite 开发服务器和 React 插件配置
├─ README.md                   # 项目简介、启动方式、部署说明与结构总览
├─ .github/workflows/         # GitHub Pages 自动测试、构建与部署流程
│
├─ src/                        # React + TypeScript 前端源码
│  ├─ main.tsx                 # 前端入口：挂载根组件并加载全局样式
│  ├─ App.tsx                  # 主界面：页面导航、案例流程与结果展示
│  ├─ styles.css               # 全局视觉样式、响应式布局及打印样式
│  ├─ components/              # 可复用的界面组件
│  │  ├─ CaseWorkflow.tsx      # V1.6 摘要卡、物流概览和草稿式配置弹窗
│  │  └─ LineChart.tsx         # Canvas 折线图：坐标域、数据点点击提示及各类结果曲线
│  └─ core/                    # 与界面解耦的前端领域逻辑
│     ├─ caseConfiguration.ts  # 组分、反应、物流、设备与计算规格对象及旧数据迁移
│     ├─ materialStream.ts     # 统一摩尔物流、组成、活度及体积流量换算
│     ├─ caseReadiness.ts      # 分区就绪校验与组分依赖保护
│     ├─ caseFile.ts           # V1.6 JSON 案例导入、导出和版本识别
│     ├─ models.ts             # 类型、默认值、输入校验、动力学/计量模型和结果解释
│     ├─ chemistry.ts          # V1.5 分子式解析与元素/电荷守恒
│     └─ multipleReactions.ts  # 通用网络、多物种衡算、自适应与刚性积分
│
├─ backend/                    # FastAPI 后端及 Python 计算基线
│  ├─ __init__.py              # Python 包标识
│  ├─ main.py                  # API 应用入口、请求模型和路由定义
│  ├─ solver.py                # 通用 BR/CSTR/PFR/PBR 求解器与数值算法
│  ├─ reactors.py              # 一级理想反应器解析解，用于基准计算和校验
│  ├─ kinetics.py              # Arrhenius 温度修正与幂律速率模型
│  ├─ stoichiometry.py         # 液相恒密度和气相变容的浓度关系
│  ├─ transport.py             # 固定床压力降关系及物理边界处理
│  ├─ energy.py                # Python 基线中的简化能量衡算辅助函数
│  ├─ validation.py            # 转化率、正值参数等通用输入校验
│  ├─ requirements.txt         # FastAPI、Uvicorn 等 Python 运行依赖
│  └─ tests/                   # Python 自动化测试
│     └─ test_analytical.py    # 解析解、计量关系、温度修正和求解器回归测试
│
├─ docs/                       # 设计、使用和验证文档
│  ├─ USER_GUIDE.md            # 面向使用者的操作、输出与导出说明
│  ├─ ARCHITECTURE.md          # 前后端模块划分、数据流和扩展原则
│  ├─ MODELS.md                # 模型假设、化学计量和反应器设计方程
│  ├─ NUMERICS.md              # Simpson、二分法和 RK4 等数值方法说明
│  ├─ API.md                   # HTTP 接口、字段和请求/响应示例
│  ├─ CASES.md                 # 典型教学案例、标准答案和误差基准
│  ├─ LIMITATIONS.md           # 当前适用边界及建议的功能扩展顺序
│  └─ TEST_REPORT.md           # 已覆盖的测试场景、验收标准和执行方式
│
├─ dist/                       # npm run build 生成的前端产物，不直接编辑
├─ node_modules/               # npm install 生成的依赖目录，不纳入源码维护
└─ .venv/                      # 可选的本地 Python 虚拟环境，不纳入源码维护
```

后续完善时，建议按职责放置新增内容：页面级流程保留在 `App.tsx`，可复用界面拆入
`src/components/`，计算与模型逻辑放入 `src/core/`；Python API 路由集中在
`backend/main.py`，领域计算拆分到对应后端模块，并在 `backend/tests/` 添加回归测试。
模型假设、接口或数值方法发生变化时，应同步更新 `docs/` 中对应文档。
