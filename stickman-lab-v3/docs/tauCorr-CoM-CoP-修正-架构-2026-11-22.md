# tauCorr：基础支撑的 CoM / CoP / 加速度 / IK 修正架构（2026-11-22）

## 1. 定位

`tauCorr` 不是一个独立的回正写手，也不是第二套支撑力。

它只做一件事：

```text
在 tauBase 已经成立的前提下
给基础支撑力加一个很小的、可解释的修正量
让 CoM / CoP / 加速度 / IK 目标同时被照顾到
```

最终输出：

```text
tauCmd = tauBase + Δtau_corr
```

其中：

```text
tauBase  = 当前姿态的完整基础支撑（含踝）
Δtau_corr = 修正量，只修基础力，不替换基础力
```

禁止：

```text
tauCorr 单独接管某根轴
tauCorr 覆盖 tauBase
tauCorr 变成一个大回正力
tauCorr 为了回正把脚世界位姿改掉
```

---

## 2. 不可违反的边界

### 2.1 WorldGrip 常开

```text
WorldGrip：脚世界位姿 + 踝抓地，始终最高优先级
```

`tauCorr` 只能进入同一个踝 PD 的力矩通道：

```text
foot2 = WorldGrip PD（脚世界位姿）
      + tauBase_ankle
      + Δtau_corr_ankle
```

不得：

```text
改脚世界目标
新建第二个 foot 写手
绕过 WorldGrip
为了 CoP 把脚从地面解出来
```

### 2.2 单轴单帧只有一个主动写手

```text
同一根轴、同一帧
只有一个主动 PD/位置写手
```

`Δtau_corr` 是该写手内部的力矩修正，不是另一个写手。

### 2.3 支撑优先于修正

```text
支撑成立 > CoM/CoP 修正 > 姿态细节
```

任一时刻都必须保留 `tauBase`。  
修正量只能叠加，不能把基础支撑“抵消掉”。

### 2.4 只处理下盘

```text
tauCorr 只作用于 hip / knee / ankle
上身仍然只作为负载
```

---

## 3. 两级结构

```text
第一级：tauBase
  输入：q, qd, 实际/保持 fz, 实际/保持 CoP, 接触
  输出：hip / knee / ankle 的基础支撑力矩
  目标：撑住当前姿态

第二级：Δtau_corr
  输入：CoM, CoM 速度, CoP, XCoM, 目标 IK, 当前 q/qd
  输出：小修正量
  目标：让 CoM/CoP 往目标走，同时不破坏第一级
```

最终：

```text
tauCmd_i = tauBase_i + Δtau_corr_i
```

---

## 4. tauBase：先把支撑算准

### 4.1 基础支撑的静态形式

当前低速阶段先用三连杆静态逆动力学：

```text
tauBase_i = ID_static(q, fz, CoP)
```

对每根关节：

```text
τ_req = sign_i * [
    Σ_j (r_j × (-m_j g))_z
  + (CoP_x - x_i) * fz
  + M_boundary
]
```

其中：

```text
r_j      关节到子树质心的水平力臂
m_j      子树质量
CoP_x    实际/保持 CoP
fz       实际/保持法向力
x_i      关节锚点
```

### 4.2 必须包含踝

```text
tauBase = { hip, knee, ankle }
```

踝的静态支撑通常很小：

```text
τ_ankle = (CoP_x - ankle_x) * fz
```

当 CoP 就在踝下时，`τ_ankle ≈ 0`。  
这不是算错，而是说明：

```text
踝要真正参与支撑，必须先移动 CoP
```

### 4.3 动态版本

后续把 `ID_static` 替换为：

```text
tauBase_i = M(q) qdd + C(q, qd) + G(q) + J^T F_contact
```

低速阶段：

```text
qdd ≈ 0
```

但 `M/C/G` 的腿部动态项仍应保留在接口里，不能把结构写死成纯静态。

### 4.4 基础支撑的约束

```text
fz / CoP 必须来自连续 LoadState
接触丢失只允许短暂 hold
不允许首帧裸 fz 直接进基础力
tauBase 每个关节仍然受限幅和速率限制
```

---

## 5. Δtau_corr 的三部分

`Δtau_corr` 不是一个单独的 PD，而是三个小修正的合成：

```text
Δtau_corr = Δtau_cop + Δtau_com + Δtau_ik + Δtau_damp
```

含义：

```text
Δtau_cop  ：CoP 位置修正（踝优先）
Δtau_com  ：CoM 加速度/速度修正
Δtau_ik   ：目标 IK 姿态的轻量拉回
Δtau_damp ：关节速度阻尼
```

每一项都必须小、平滑、有限幅。

---

## 6. CoM / CoP 目标

### 6.1 XCoM

低速站立/蹲姿用 LIPM：

```text
ω = sqrt(g / h)
XCoM = CoM_x + CoM_vx / ω
```

侧向同理：

```text
XCoM_z = CoM_z + CoM_vz / ω
```

### 6.2 CoP 目标

```text
CoP*_x = clamp(XCoM_x, foot_min_x + margin, foot_max_x - margin)
CoP*_z = clamp(XCoM_z, foot_min_z + margin, foot_max_z - margin)
```

要求：

```text
CoP* 永远在安全支撑面内
margin 随 fz / 摩擦 / 接触质量收缩
CoP* 不允许为了追 CoM 跑出脚底
```

### 6.3 CoP 修正

```text
e_p = CoP* - CoP_actual
ė_p = CoP_vel* - CoP_vel
```

踝是主执行器：

```text
Δtau_cop_ankle =
  clamp(
    -Kcop_p * e_p
    - Kcop_d * ė_p,
    ±cap_cop
  )
```

符号必须用 ±1° 目标阶跃先验证，不允许凭经验写反。

### 6.4 CoM 加速度修正

期望 CoM 加速度：

```text
a*_x = ω² * (CoM_x - CoP*_x)
a*_z = ω² * (CoM_z - CoP*_z)
```

期望合力修正：

```text
ΔF_x = m * (a*_x - a_measured_x)
ΔF_z = m * (a*_z - a_measured_z)
```

分配到关节：

```text
Δtau_com_i = J_com_i^T * ΔF
```

再经过：

```text
限幅
低通
支撑可行域投影
```

`ΔF_z` 只能很小，主要用于卸载/加载协调，不允许把脚压穿或抬离。

---

## 7. IK 姿态修正

### 7.1 目标

`Δtau_ik` 不是为了抢支撑，而是防止：

```text
CoM/CoP 修正把关节慢慢带离目标 IK 姿态
```

### 7.2 输入

```text
q_ik     目标 IK 关节角
q        当前关节角
qd       当前关节速度
```

### 7.3 小修正

```text
e_q = q_ik - q
a_ik = Kik_p * e_q - Kik_d * qd
Δtau_ik = M_leg(q) * a_ik + C_leg(q, qd)
```

低增益、低限幅。  
`M_leg / C_leg` 不可用时，退化为：

```text
Δtau_ik = Kik_p * e_q - Kik_d * qd
```

### 7.4 IK 修正的边界

```text
不得把 q 直接硬拉回 q_ik
不得越过 WorldGrip 的脚位姿
不得和其他轴抢同一个目标
```

---

## 8. 踝、膝、髋的分配

### 8.1 踝优先

```text
CoP 修正先给踝
```

原因：

```text
踝力矩直接决定 CoP
CoP 是 CoM 加速的第一入口
```

### 8.2 膝、髋接剩余

```text
Δtau_cop_ankle = 主 CoP 修正
Δtau_cop_knee  = 小比例、慢速
Δtau_cop_hip   = 最后的小比例
```

建议初始权重：

```text
ankle 0.5
knee  0.3
hip   0.2
```

权重不是固定力，而是**修正预算的分配比例**。

### 8.3 不允许

```text
髋直接发大 CoP 力
膝和踝抢同一个 CoP 目标
髋/膝修正把支撑力矩抵消
```

---

## 9. 安全投影：小力矩、不破坏支撑

`Δtau_corr` 计算出来后，必须经过投影，不能直接下发。

### 9.1 绝对限幅

```text
|Δtau_corr_i| <= cap_abs_i
```

建议初始：

```text
ankle 4 N·m
knee  4 N·m
hip   6 N·m
```

### 9.2 相对基础力限幅

```text
|Δtau_corr_i| <= frac_base * |tauBase_i|
```

建议：

```text
frac_base = 0.15
```

基础力越小，修正越小；不允许修正量主导基础力。

### 9.3 速率限制

```text
|Δtau_corr_i(k) - Δtau_corr_i(k-1)| <= slew_i * dt
```

建议：

```text
slew = 20 N·m/s
```

### 9.4 支撑可行域

```text
CoP_cmd = CoP_actual + ΔCoP(Δtau_corr)
```

必须满足：

```text
CoP_cmd ∈ [foot_min + margin, foot_max - margin]
fz >= 0
摩擦锥内
接触有效
```

如果越界：

```text
按比例缩小 Δtau_corr
不是让 CoP 越界
```

### 9.5 联合缩放

统一缩放因子：

```text
s = min(
  1,
  cap_abs / |Δtau_raw|,
  (frac_base * |tauBase|) / |Δtau_raw|,
  CoP_margin / |ΔCoP_raw|,
  Fz_margin / |ΔFz_raw|
)
```

最终：

```text
Δtau_corr = s * Δtau_raw
```

`s` 必须平滑变化，不能一帧 1 一帧 0。

---

## 10. 最终合成

```text
tauCmd = tauBase + Δtau_corr
```

踝：

```text
foot2 = WorldGrip PD
      + tauBase_ankle
      + Δtau_corr_ankle
```

膝：

```text
knee2 = tauBase_knee + Δtau_corr_knee
```

髋：

```text
hip2 = tauBase_hip + Δtau_corr_hip
```

所有轴：

```text
仍然经过原有 PD/被动刚度/限幅
tauCorr 不新增第二个写手
```

---

## 11. 运行顺序

每帧：

```text
1. 采样 q, qd, CoM, CoM 速度
2. 读取连续 LoadState：fz, CoP, 接触, 摩擦
3. 计算 tauBase（含踝）
4. 计算 XCoM / CoP* / a*
5. 计算 Δtau_raw = cop + com + ik + damp
6. 安全投影：限幅、比例、速率、CoP 边界
7. tauCmd = tauBase + Δtau_corr
8. 写入原 PD
9. 记录逐帧 debug
```

禁止顺序：

```text
先写 tauCorr 再补 tauBase
tauCorr 覆盖 PD
tauCorr 改 foot 世界目标
```

---

## 12. 频率与窗口

`Δtau_corr` 是修正量，不是回正通道，默认**每帧都有**，但必须小。

```text
CoM/CoP 外环：50–100 Hz
关节修正：每个物理帧
低通：30–50 ms
```

如果以后需要更强回正：

```text
SAG / LAT 窗口只放大对应权重
不产生第二套写手
窗口之间回到小修正
```

---

## 13. 失效与回退

| 条件 | 行为 |
|---|---|
| 接触丢失 | `Δtau_corr` 在 1–2 帧内衰减到 0，`tauBase` 保留 |
| fz 无效 | 使用 LoadState hold；hold 超时后修正归零 |
| CoP 饱和 | 按比例缩小修正，不允许越界 |
| 摩擦不足 | 降低 `ΔF_x/ΔF_z`，踝优先 |
| IK 不可达 | 夹紧 `q_ik`，修正限幅 |
| 关节饱和 | 修正优先让位，基础支撑优先 |
| 已经判倒 | 停止修正，不抽搐 |
| 加速度噪声大 | 低通/死区，不用高频 qdd |

---

## 14. 逐帧 debug

必须能回读：

```text
tauBase: hip / knee / ankle
Δtau_raw: cop / com / ik / damp
scale: cap / baseFrac / CoP / friction
Δtau_corr 最终值
CoP actual / CoP target
XCoM x/z
a* x/z
q_ik - q
joint applied / cmd / writes
```

要求任意一帧都能回答：

```text
基础支撑是多少
修正想加多少
为什么被缩小
CoP 是否还在安全区
踝有没有先动
```

---

## 15. 验收标准

1. 静止蹲姿：`Δtau_corr ≈ 0`，姿态不漂。
2. 1 cm CoM 偏移：CoP 先动，踝先出力，髋不先顶。
3. `foot2` 不再长期为 0。
4. 修正过程中 CoP 不越界、fz 不为负。
5. 任意关节 `|Δtau_corr|` 不超过基础力的 15%。
6. 关节饱和时，基础支撑仍然保留。
7. 摔倒时间不因 tauCorr 变短。
8. 逐帧 debug 能看到完整的“基础 + 修正 + 缩放”链路。

---

## 16. 非目标

本版不做：

```text
全身 QP
完整 M/C 全身动力学
迈步/抬脚救回
上身主动回正
用 tauCorr 替代支撑
用 tauCorr 硬拉 IK 目标
```

本版只做：

```text
基础支撑 + 小 CoM/CoP/加速度/IK 修正
```

---

## 17. 与旧文档的关系

- `docs/蹲姿回正写手-新架构-2026-11-22.md`
  - 仍定义 WorldGrip、HOLD/SAG/LAT、单写手所有权。
  - 本文把其中的“tauCorr”细化为 CoM/CoP/加速度/IK 修正量。
- `docs/CoP回正-论文修正-2026-11-16.md`
  - 提供 XCoM/CoP 论文依据。
  - 本文不采用“独立回正写手”的形式，改为 `tauBase + Δtau_corr`。

## 18. 当前实现状态

```text
已实现：静态 tauBase（hip / knee / ankle）
已实现：WorldGrip
已实现：foot2 基础踝 ext
待替换：旧 tauCorr（IK/加速度回正写手形式）
待实现：CoM/CoP 目标、安全投影、逐帧 debug
```

当前旧 `tauCorr` 必须按本文重写，不能继续扩展旧形式。
