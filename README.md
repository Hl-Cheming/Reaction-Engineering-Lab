# 反应工程实验室

面向化学工程学生的交互式学习与计算项目。当前交付覆盖 P0 与 P1 核心范围：BR、CSTR、PFR、PBR，幂律动力学、Arrhenius 温度修正、液相恒密度、气相变容、PBR 简化压力降、反应器横向对比、Levenspiel 图、输入校验、本地输入恢复与 CSV 导出。

## 启动网页

需要 Node.js 22.13 或更高版本。

```bash
npm install
npm run dev
```

浏览器打开终端显示的本地地址。

## 启动 Python API

在项目父目录执行：

```bash
python -m venv .venv
.venv/Scripts/activate
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload
```

API 文档位于 `http://127.0.0.1:8000/docs`。

## 自动化测试

```bash
python -m unittest discover -s backend/tests -v
npm run build
```

网页计算逻辑与 Python API 分离；网页可独立运行，Python API 提供标准化教学接口和解析解校验基线。
