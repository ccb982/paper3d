# 基线：FrameCommand 唯一执行路径（2026-11-26）

## 结论

下半身已经收敛成：

```text
proposal 收集
→ FrameCommand
→ 一次执行
```

不再使用：

```text
SQC_FRAME_APPLY 双路径
lower proposal 直接执行
```

## 当前范围

```text
下半身：
  hip / knee / foot / ankle
  angle
  support/active
  passive
  external
  drive
  antiG
→ FrameCommand

上半身：
  暂不纳入
```

## 回读

```text
full ≈ 1.06s
Chrome 无抬脚
minFzTotal ≈ 454N
typecheck 通过
```

## 当前未完成

```text
FrameCommand 仍在 control 尾部生成
Stage 0 抓地只写 contact/locked 元数据
FootContactTask 还不是硬约束
fullTsid 只是独立 shadow 模块
旧支撑仍是支撑来源
```

## 下一步

```text
1. 生成点移进 SquatCommand
2. Stage 0/1/2/3 真正写 FrameCommand
3. 支撑力闭环
4. foot contact 从元数据升级为约束
5. fullTsid 通过 shadow 验证后再接
```

当前基线用于后续优化，不再接受半迁移/多写手改动。
