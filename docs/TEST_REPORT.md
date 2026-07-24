# 自动化测试报告

测试范围：

- 一级 BR 与解析式 `t=ln[1/(1−X)]/k` 比较。
- 一级 CSTR 与 `X=Da/(1+Da)` 比较。
- 一级 PFR 与 `X=1−exp(−Da)` 比较。
- Arrhenius 参考温度恒等检查。
- 气相计量关系与 PBR 压力失效边界检查。
- 网站生产构建与类型编译检查。

验收要求：BR、CSTR、PFR 解析解相对误差不超过 `1×10⁻⁶`。测试代码以 12 位小数比较，严格于验收要求。

执行命令：

```bash
python -m unittest discover -s backend/tests -v
npm run build
```

最终执行结果记录：5 项模型测试全部通过；网站生产构建通过。
