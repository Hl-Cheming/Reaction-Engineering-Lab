# API 输入输出说明

## `GET /api/health`

返回 `{"status":"ok"}`。

## `POST /api/v1/first-order`

一级不可逆反应的 BR、CSTR 或 PFR 解析计算。

请求示例：

```json
{
  "reactor": "PFR",
  "target_x": 0.8,
  "k_ref": 0.25,
  "temperature": 350,
  "ref_temperature": 350,
  "activation_energy": 52000,
  "volumetric_flow": 0.5
}
```

响应示例：

```json
{
  "reactor": "PFR",
  "target_x": 0.8,
  "size": 3.2188758249,
  "unit": "L",
  "k_at_temperature": 0.25
}
```

非法转化率、非正温度或非正流量返回 HTTP 422，并明确指出参数原因。

## `POST /api/v1/calculate`

与本地网页 V1 范围一致的通用接口，支持 BR、CSTR、PFR、PBR，幂律级数、液相/气相、由目标 X 求尺度或由尺度反求 X，以及 PBR 压降。

请求在前述公共字段基础上增加：

- `phase`: `liquid` 或 `gas`
- `solve_for`: `target` 或 `size`
- `size`, `order`, `ca0`, `fa0`, `epsilon`
- `pressure_drop`, `alpha`

返回 `scale`、`outlet_x`、`outlet_ca`、`outlet_rate`、`pressure_ratio` 和 `k_at_temperature`。
