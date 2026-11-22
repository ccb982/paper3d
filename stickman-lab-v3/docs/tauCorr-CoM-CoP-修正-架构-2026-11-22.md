# tauCorr：基础支撑的 CoM / CoP / 加速度 / IK 修正架构（2026-11-22）

## 0. 设计修订

旧设计把“回正力”当成独立的一股力，和基础支撑同时写同一根轴，结果就是：

```text
支撑：维持当前姿态
回正：把姿态拉向目标
两个写手在同一轴对拉
```

本版取消“独立回正力”：

```text
回正 = tauCorr
tauCorr = tauBase 的修正量
不是第二股力
不是第二个写手
```

最终只有：

```text
tauCmd = tauBase + tauCorr
```

所有下盘主动轴仍然只有一个主动写手。  
`tauCorr` 只改变基础支撑的净输出，不接管任何轴。

这一版先做小偏差。  
大偏差的 SAG/LAT 接管保留，但放到后续阶段，见 §19。

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

## 5. Δtau_corr 分两层，顺序不能反

`Δtau_corr` 不是一个单独的 PD，也不是一上来就做 CoM/CoP 回正。

```text
第一层：Δtau_acc
  超高精度加速度缺口补偿
  补支撑力
  首要任务

第二层：Δtau_predict
  CoM / CoP / IK / 阻尼
  属于预测项
  加速度缺口补上之后才做
```

合成：

```text
Δtau_corr = Δtau_acc + Δtau_predict
```

### 5.1 Δtau_acc：补加速度/支撑缺口

```text
Δtau_acc = 维持当前姿态所需力矩 − 当前基础支撑/已输出力矩
```

动态版本：

```text
tauNeed = M(q)qdd + C(q,qd) + G(q) + J^T F_contact
Δtau_acc = tauNeed − tauBase
```

低速静态版本：

```text
Δtau_acc = ID_static(q, fz, CoP) − tauBase
```

交接首帧：

```text
Δtau_acc = 上一帧 applied − tauBase
```

要点：

```text
超高精度加速度在这里抵消
支撑缺口在这里补
只补支撑，不做 CoM/CoP/IK 预测
```

### 5.1.1 加速度测量要求

不能再用普通 `comAcc` 差分。当前链路：

```text
comVel：100ms 低通
comAcc：(comVel[k] - comVel[k-1]) / dt
lateralSense.comAccZ：再 30ms 低通
sagittalSensorFrame.acceleration：当前直接写 0
```

所以 `comAcc`：

```text
滞后 100ms 级
差分噪声大
高频不可信
```

超高精度加速度必须来自：

```text
关节 qdd（编码器/执行器）
+ 惯性测量（骨盆/躯干）
+ 接触力/力矩
+ 完整逆动力学
+ 时间同步/状态观测器
```

指标：

```text
延迟：<= 5ms（相对控制帧）
采样：与控制同频或更高
噪声：<= 0.01–0.02 m/s²（滤波后）
低通：<= 10–20ms
标定：重力/安装偏差/零偏
```

仿真里可以直接用刚体真实加速度；实机不能把 `comAcc` 差分当真实加速度。

实测原始相邻步差分（未滤波）：

```text
hip2 qdd:   ±545 ~ ±2700 rad/s²
knee2 qdd:  ±30 ~ ±128 rad/s²
ankle2 qdd: ±17 ~ ±262 rad/s²
comAcc:     ±2 m/s²
```

这些尖峰主要来自接触冲量和 PD 振荡，**不能直接作为超高精度加速度使用**。  
所以不能选“只测关节”或“只测肢体”，必须：

```text
关节 qdd：用于 M(q)qdd 逆动力学问
肢体/躯干加速度：用于接触力、COM、基座运动
接触力/力矩：用于修正冲量和未建模外力
IMU/编码器/状态观测器：融合，不能裸差分
```

下一步应做模型观测器：

```text
qdd_est = M(q)^-1 [ tau_meas − C(q,qd) − G(q) − J^T F_contact ] + K(IMU − qdd_pred)
```

而不是把裸 qdd / 裸 comAcc 直接送进 tauCorr。

### 5.1.2 论文里的做法

不要自己发明“再差分一次”。文献的主线是：

1. **编码器 + IMU 的自适应 EKF**
   - Baradaran Birjandi, Khurana, Billard, Haddadin, 2023
   - *A Stable Adaptive Extended Kalman Filter for Estimating Robot Manipulators Link Velocity and Acceleration*
   - 状态：q、qd、qdd；测量：编码器 + 分布式 IMU；自适应 Q/R。
   - 结论：比裸差分稳，且能在线适应模型/传感器变化。

2. **每节肢体一个 IMU**
   - Nori, Traversaro, Fallon, 2016
   - *Sensor fusion and State estimation of the robot*
   - 关节角加速度 = 相邻连杆角加速度差；需要每节肢体 IMU 或每个连杆多个加速度计。
   - 报告：关节加速度 RMSE 约 8.3 deg/s²。

3. **Momentum observer**
   - De Luca & Mattone, 2003；Garofalo et al., 2019
   - *Sliding Mode Momentum Observers for Estimation of External Torques and Joint Acceleration*
   - 不直接对 q 二次差分：
     ```text
     p = M(q) qd
     r = K [ p − p0 − ∫(tau + C^T qd − g + r) dt ]
     ```
   - `r` 估计外力矩；再由动力学反解 qdd。
   - 优点：避开 qdd 噪声；缺点：依赖 M/C/G 和摩擦模型。

4. **浮动基/质心 EKF**
   - Xinjilefu & Atkeson, 2015
   - *State Estimation for Humanoid Robots*
   - IMU 的线加速度 + 角速度 + 足底 F/T/CoP 融合；CoM 加速度由 IMU 加速度平移到 CoM：
     ```text
     a_com = a_imu + ω × (ω × r) + ωdot × r
     ```
   - 足底力/CoP 作为测量，不是直接积分 qdd。

5. **质心状态估计**
   - Ficht & Behnke, 2023
   - *Centroidal State Estimation and Control for Hardware-constrained Humanoid Robots*
   - 多质量模型 + IMU + 编码器 + 足底接触，估计 centroidal state / CoP。

### 5.1.3 本项目选择

```text
关节层：
  每条腿的 q/qd/qdd 用 EKF 或 momentum observer
  不以裸 qdd 作为控制输入

肢体层：
  大腿 / 小腿 / 脚 / 骨盆 / 躯干分布式 IMU
  用于基座和接触力估计

质心层：
  floating-base / centroidal EKF
  IMU + 编码器 + 足底力/CoP

支撑缺口：
  momentum observer 的 r
  或 tauNeed − tauApplied
```

所以答案是：

```text
不是只测每个关节
也不是只测完整肢体
是“关节 qdd + 分布肢体 IMU + 质心 EKF + 动量观测器”
```

只选一个都不够。

### 5.1.4 削加速度 + 精确抵消

只测加速度不够，控制要同时做两件事：

```text
1. 削加速度：降低/平滑实际加速度需求
2. 精确抵消：用前馈力矩抵消已知加速度
```

不是二选一，是分频段：

```text
低频、可建模：精确抵消
高频、冲击、模型差：削 + 阻尼
```

#### 削加速度

手段：

```text
目标加速度限幅 / jerk 限制
CoM / CoP 参考低通
关节命令低通
阻抗/阻尼（K/B）
柔顺接触/足部
速率限制
```

效果：

```text
不跟高频尖峰对拉
减少 tauCorr 的高频需求
让支撑链先稳住
```

#### 精确抵消

```text
Δtau_cancel = tauNeed − tauBase
```

动态形式：

```text
tauNeed = M(q) qdd_est + C(q,qd) + G(q) + J^T F_contact
```

要求：

```text
qdd_est 来自 EKF / momentum observer
不是裸差分
低频可信
高频不强行抵消
```

#### 合成

```text
Δtau_acc = Δtau_cancel + Δtau_shape
```

其中：

```text
Δtau_cancel：精确抵消（低频、前馈）
Δtau_shape ：削加速度（滤波、阻尼、限幅）
```

顺序：

```text
先削掉不可信的高频需求
再精确抵消可建模的低频需求
剩余交给 Δtau_predict
```

禁止：

```text
用高增益加速度反馈硬顶尖峰
用裸 qdd 做精确抵消
用削加速度代替支撑
```

### 5.1.5 从源头削加速度：阻尼与软组织

只在 tauCorr 里抵消，是“事后补救”。  
更根本的是降低加速度的产生：

```text
接触柔顺
关节粘弹性
肌肉短程刚度/阻尼
躯干/器官软组织的分布阻尼
```

当前模型的问题：

```text
刚体多
body linearDamping=0.05 / angularDamping=0.1（很低）
主要阻尼靠关节 PD Kd
没有器官/软组织缓冲
接触偏硬
```

结果：

```text
冲击直接进关节
qdd 尖峰 ±500~2700 rad/s²
tauCorr 再快也只能追着补
```

人体实测的被动阻尼量级（供标定参考）：

```text
髋：约 2–9 Nms/rad（静态/摆动不同）
膝：被动约 1–2 Nms/rad
踝：约 0.8–3 Nms/rad（70kg 量级）
```

当前关节 PD 阻尼：

```text
hip0 Kd 20
hip1 Kd 10
hip2 Kd 2
knee2 Kd 8 + 被动 6 = 14
ankle 被动 B 约 1
upper Kd 24/40
```

分布不对：

```text
近端髋/上身阻尼偏高
远端踝/足阻尼偏低
缺少全身软组织阻尼
```

目标不是把所有 Kd 调大，而是：

```text
1. 足/接触增加柔顺和阻尼
2. 踝/膝增加低幅被动粘弹性
3. 髋/上身减少硬 Kd，改由分布阻尼吸收
4. 躯干/器官用等效质量-弹簧-阻尼
5. 主动肌肉阻尼只在支撑期、按速度/负荷开启
```

这样：

```text
高频加速度在接触/软组织/关节被动层被削掉
低频支撑缺口再交给 Δtau_cancel 精确抵消
```

论文依据：

- Wakeling & Nigg, 2001
  - 软组织共振约 15Hz；阻尼随肌肉力/激活增加。
- De Groote et al., 2017
  - 肌肉短程刚度（short-range stiffness）在扰动初期的关节力矩中占主导。
- “Muscle short-range stiffness behaves like a Maxwell element, not a spring”, PLOS One, 2024
  - 短程刚度不是纯弹簧，而是 Maxwell（弹簧+阻尼串联）；阻尼是稳定关节的关键。
- van der Zee & Kuo, 2021
  - 人体步行中约 63% 的负功由软组织耗散，软组织阻尼不可忽略。
- Koopman et al., 2016
  - 髋阻尼约 1.9–9 Nms/rad；膝被动约 1 Nms/rad，主动约 2.9 Nms/rad。
- Shorter et al., 2012
  - 踝阻尼约 0.012–0.038 Nms/rad/kg（70kg 约 0.8–2.7 Nms/rad）。

结论：

```text
人体阻尼不是“全身一个 Kd”
是关节/肌肉/软组织/接触的分布 Maxwell 阻尼
```

当前模型把这些都塞进关节 PD Kd，方向不对。

### 5.2 Δtau_predict：预测项

支撑缺口补上后，余量才用于：

```text
Δtau_predict = Δtau_cop + Δtau_com + Δtau_ik + Δtau_damp
```

含义：

```text
Δtau_cop：CoP 位置修正（踝优先）
Δtau_com：CoM 位置/速度修正
Δtau_ik ：目标 IK 的轻量拉回
Δtau_damp：关节速度阻尼
```

注意：

```text
CoM/CoP/IK 是预测项，不是首要补偿
右侧不再单独有“加速度回正”项
加速度已经归入 Δtau_acc
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

### 6.4 预测项不再单独用加速度

加速度已经归入 `Δtau_acc`：

```text
Δtau_acc = tauNeed(dynamic) − tauBase
```

`Δtau_predict` 只用：

```text
CoM 位置/速度
CoP 位置
IK 误差
关节阻尼
```

不再出现：

```text
Δtau_acc（作为预测项）
J^T (a* − a_measured)
```

预测项只处理“加速度/支撑缺口补完之后还剩多少位置/速度偏差”。

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

稳态建议：

```text
ankle 8 N·m
knee 15 N·m
hip  20 N·m
```

交接瞬态建议（仅 handoff 分量）：

```text
ankle 10 N·m
knee  20 N·m
hip   30 N·m
```

这些是**命令层修正上限**，不是执行器上限（hip 800 / knee 450 / foot 320）。

### 9.2 相对基础力限幅

```text
|Δtau_corr_i| <= frac_base * |tauBase_i|
```

建议：

```text
frac_base = 0.30
```

基础力越小，修正越小；不允许修正量长期主导基础力。  
交接首帧的连续性由 handoff 分量的独立 cap 负责，不受这条限制。

### 9.3 速率限制

```text
|Δtau_corr_i(k) - Δtau_corr_i(k-1)| <= slew_i * dt
```

建议：

```text
slew = 40 N·m/s
```

handoff 分量本身是 (1-u) 衰减，不额外加 slew 跳变。

### 9.3.1 总命令上限

```text
|tauBase_i + Δtau_corr_i| <= cap_cmd_i
```

建议：

```text
ankle 40 N·m
knee 120 N·m
hip  120 N·m
```

总命令仍低于执行器上限，给被动层和 PD 留余量。

### 9.3.2 实测预算依据（2026-11-22 回读）

回读窗口 `0–0.8s`，脚本对比：

```text
gap_base_applied = id - applied
gap_base_ff      = id - hipFf/kneeFf/foot2Local
```

结果：

```text
hip base-ff:
  mean -2.6
  p10 -10.0
  p50 -2.5
  p90 +4.9
  p99 +9.2
  max +30.0（handoff 首帧）

knee base-ff:
  mean -0.7
  p10 -6.6
  p50 -1.2
  p90 +6.2
  p99 +12.0
  max +14.9

ankle base-ff:
  mean +1.5
  p10 -0.3
  p50 +0.7
  p90 +4.8
  p99 +6.1
  max +6.6
```

`base-applied` 不能直接拿来做预算：

```text
hip p90 +80 / max +116
```

因为 `applied` 包含 PD 阻尼和速度项，振荡远大于支撑缺口。

据此：

```text
稳态修正预算：
  hip 20
  knee 15
  ankle 8

handoff 首帧预算：
  hip 30
  knee 20
  ankle 10
```

这与实测 p99/最大值一致，且仍远低于命令层总上限。

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
1. 采样 q, qd, 高精度 qdd/加速度, CoM
2. 读取连续 LoadState：fz, CoP, 接触, 摩擦
3. 计算 tauBase（含踝）
4. 计算 Δtau_acc = tauNeed − tauBase
5. 计算 XCoM / CoP* / 预测项
6. 计算 Δtau_predict = cop + com + ik + damp
7. Δtau_corr = 投影(Δtau_acc + Δtau_predict)
8. tauCmd = tauBase + Δtau_corr
9. 写入原 PD
10. 记录逐帧 debug
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
小偏差仍用 tauCorr
大偏差才进入 SAG / LAT 接管
接管前该轴 tauCorr 先衰减到 0
SAG/LAT 是该轴唯一主动写手
窗口之间回到 tauCorr
```

不是：

```text
tauCorr + SAG/LAT 同时叠加
```

SAG/LAT 属于后续阶段，本版只实现小偏差 tauCorr。

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
5. 任意关节 `|Δtau_predict|` 不超过基础力的 30%；`Δtau_acc` 单独受 handoff/绝对 cap 限制。
6. 关节饱和时，基础支撑仍然保留。
7. 纯 `tauBase + tauCorr`（不启用 SAG/LAT）的 TTF 至少 3–4s。
8. 摔倒时间不因 tauCorr 变短。
9. 逐帧 debug 能看到完整的“基础 + 修正 + 缩放”链路。

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
基础支撑
+ 支撑缺口/加速度补偿（首要）
+ 小 CoM/CoP/IK 回正（其次）
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

---

## 19. 与 SAG / LAT 的阶段划分

```text
小偏差：
  tauBase + tauCorr
  所有下盘主动轴仍由 StateHold 写

大偏差：
  SAG / LAT 接管对应关节组
  tauCorr 先在对应轴衰减到 0
  SAG/LAT 成为该轴唯一主动写手
```

两阶段不重叠：

```text
不是 tauBase + tauCorr + SAG/LAT
```

SAG/LAT 是后续大偏差阶段，本版先完成小偏差 `tauCorr`。

---

## 19. 文献依据：没有叫 tauCorr 的论文，但有完整同类设计

`tauCorr` 是工程名，不是论文术语。它对应的是：

```text
Capture Point / XCoM / CoP 反馈
+ ankle / hip / stepping 策略
+ task-space inverse dynamics
+ hierarchical QP / prioritized control
```

可直接对照的文献：

1. **Pratt et al., 2006**
   - *Capture Point: A Step toward Humanoid Push Recovery*
   - 核心：用 Capture Point 判断“脚该放哪/还能不能靠踝救”。

2. **Hof, Gazendam, Sinke, 2005**
   - *The extrapolated center of mass concept suggests a simple control of balance in walking*
   - 核心：XCoM；小扰动用踝/CoP，大扰动需要髋或步。

3. **Kim, Lim, Park, Lee, Park, 2023/2025**
   - *A Model Predictive Capture Point Control Framework for Robust Humanoid Balancing via Ankle, Hip, and Stepping Strategies*
   - arXiv:2307.13243
   - 最接近本文：
     - Capture Point 误差驱动
     - 踝 / 髋 / 步三策略
     - **按误差大小动态调整策略权重**
     - 小误差踝，大误差才上髋/步

4. **Shafiee-Ashtiani et al., 2017**
   - *Push Recovery of a Position-Controlled Humanoid Robot Based on Capture Point Feedback Control*
   - arXiv:1710.10598
   - 踝 = CoP 控制，髋 = CMP 控制；给出 CP 误差到踝力矩的 PD 形式。

5. **Herzog, Righetti, Grimminger, Pastor, Schaal, 2014**
   - *Balancing experiments on a torque-controlled humanoid with hierarchical inverse dynamics*
   - arXiv:1305.2042
   - 核心：物理约束/接触/CoP/摩擦放最高优先级，平衡任务其次，姿态最后。
   - 这支持“不能为了修正破坏支撑”的硬优先级。

6. **Del Prete, Nori, Metta, Natale, 2014**
   - *Prioritized Motion-Force Control of Constrained Fully-Actuated Robots: “Task Space Inverse Dynamics”*
   - arXiv:1410.3863
   - 核心：多任务严格优先级；低优先级只能在 null space 里做。

结论：

```text
不是没有论文
而是论文不叫 tauCorr
论文叫 capture point / CoP / hierarchical inverse dynamics / prioritized WBC
```

本文的 `tauBase + Δtau_corr` 是一种简化实现：

```text
tauBase 对应支撑/接触约束
Δtau_corr 对应 Capture Point / CoP / 姿态任务
安全投影对应 hierarchy 的最高层约束
```

---

## 20. 按“偏离距离 / 加速度 / IK 误差”排序

这个方向是对的，而且文献里就是这么做的。  
但不能直接按原始数值排序，必须先**归一化**，再排序/分窗。

### 20.1 严重度指标

```text
s_cop = |CoP* - CoP| / cop_margin
s_com = |XCoM - CoP| / support_half_width
s_acc = |a* - a_measured| / a_cap
s_ik  = ||q_ik - q|| / q_band
s_vel = |CoM_vel| / v_ref
```

综合严重度：

```text
S = max(s_cop, s_com, s_acc) + w_ik * s_ik
```

建议用 `max` 而不是简单求和：

```text
一个方向已经危险时
不能被另一个小误差平均掉
```

### 20.2 分层顺序

硬优先级：

```text
0. 接触 / 摩擦 / CoP 边界 / 关节限幅
1. tauBase 基础支撑
2. 踝 CoP 修正
3. 膝/髋剩余 CoM 修正
4. IK 姿态拉回
5. 关节阻尼
```

软优先级：

```text
同一层内部
按 s_cop / s_com / s_acc 动态分配权重
```

### 20.3 分窗

```text
S < 0.3
  只保留阻尼 + 很轻的 IK

0.3 <= S < 0.7
  踝 CoP 修正为主
  膝/髋只接少量

0.7 <= S < 1.2
  踝 + 膝 + 髋
  修正预算按能力分配
  CoP 仍必须留在安全区

1.2 <= S
  踝可能已饱和
  不再硬加踝
  保持基础支撑
  修正冻结/缓慢衰减
  需要步/外部救援，而不是更大 tauCorr
```

### 20.4 排序不是“越大越猛”

必须加：

```text
死区
滞回
驻留时间
低通
速率限制
```

否则会在阈值附近来回切，形成抖动。

### 20.5 和 tauCorr 的关系

```text
排序决定“先修哪个、修多少”
不决定“用大扭矩”
```

最终仍然是：

```text
tauCmd = tauBase + Δtau_corr
```

且：

```text
|Δtau_corr| 小
CoP 不越界
支撑优先
```

这与 Kim 2025 的“小误差踝、大误差髋/步”以及 Herzog 2014 的层次约束一致。
