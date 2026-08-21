# 代码结构说明

## 前端

- `src/App.tsx`：页面状态、任务配置、案例工作流入口和结果组件。
- `src/components/CaseWorkflow.tsx`：流程概览、摘要卡和草稿提交式配置弹窗。
- `src/core/caseConfiguration.ts`：V1.6 组分、反应、物流、反应器和计算规格对象，以及旧输入迁移。
- `src/core/materialStream.ts`：相态无关的统一物流状态及浓度/分压到摩尔物流的换算。
- `src/core/caseReadiness.ts`：五类案例对象的就绪校验与组分依赖保护。
- `src/core/caseFile.ts`：V1.6 案例 JSON 的版本化导入、导出和迁移入口。
- `src/core/models.ts`：输入校验、计量关系、动力学、反应器计算、公式元数据与工程提示。
- `src/core/chemistry.ts`：分子式解析、元素组成矩阵及电荷守恒检查。
- `src/core/multipleReactions.ts`：动态计量矩阵、逐反应可逆驱动力、任意转化率观察组分、自适应/刚性 ODE 与 CSTR 代数方程。
- `src/components/LineChart.tsx`：只依赖统一数值序列的 Canvas 绘图组件。
- `src/styles.css`：清华紫、本地课堂投屏与移动端响应式样式。

## 后端

- `backend/kinetics.py`：Arrhenius 与幂律动力学。
- `backend/stoichiometry.py`：液相/气相浓度换算。
- `backend/reactors.py`：解析解基线。
- `backend/transport.py`：压力降边界。
- `backend/validation.py`：公共输入检查。
- `backend/main.py`：FastAPI 接口。

## 扩展原则

数据流为 `弹窗草稿 → Inputs 兼容层 → CaseConfiguration/MaterialStream → 求解器配置 → Result`。未来串联设备应直接传递 `MaterialStream`，不得重新建立只含某一基准组分的专用物流字段。新增反应机理/PSSH 或 RTD 时，应继续使用独立模型模块和任务配置。
