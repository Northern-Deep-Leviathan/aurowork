# 全局共享 Model 选择重构

> 状态：方案待批准
> 日期：2026-05-11
> 关联文件（前端）：
> - `apps/app/src/app/app.tsx` — model state、resolver、picker handler
> - `apps/app/src/app/context/session.ts` — `SessionModelState`
> - `apps/app/src/app/components/model-picker-modal.tsx`
> - `apps/app/src/app/components/session/composer.tsx`
> - `apps/app/src/app/pages/session.tsx`
> - `apps/app/src/app/constants.ts`

## 现状速览

当前 model 选择是 **per-session** 的：

```
selectedSessionModel =
  sessionModelOverrideById[sessionId]              ← 用户在该 session 里点过的
  ?? sessionModelById[sessionId]                   ← 从该 session 历史消息提取的
  ?? lastUserModelFromMessages(messages)
  ?? firstConnectedProviderModel()                 ← 兜底
  ?? DEFAULT_MODEL                                 ← 硬编码
```

新建 session 时拿 `firstConnectedProviderModel()` 作为初始 model，给用户一种"每次都被重置成 default"的体验。

持久化在 localStorage `aurowork.sessionModels.<workspaceId>`，按 `sessionId → ModelRef` 索引。

## 用户需求重述

| # | 需求 | 已确认决策 |
|---|---|---|
| 1 | 全局共享一个"当前 model" | ✅ **跨 workspace 全应用共享**（一个 key，不按 workspace 分） |
| 2 | 用户在任意 session 里改 model = 改全局 | ✅ |
| 3 | 新建 session 显示全局 model | ✅ |
| 4 | 打开旧 session 时，model chip 显示全局 model（不显示历史的） | ✅ "始终显示全局" |
| 5 | 全局为空时 chip 显示 "Choose model" | ✅ |
| 6 | 没有 connected provider 时 chip 显示 "Add provider" | ✅，点击直接弹 Provider Auth Modal |
| 7 | model variant（reasoning effort 等）保持现状（按 model 维度记忆） | ✅ |

## 新模型

### State（极简）

```ts
// app.tsx 顶层（全局，不按 workspace 分）
const [globalModel, setGlobalModel] = createSignal<ModelRef | null>(null);
```

持久化：localStorage 单个 key，例如：

```
aurowork.globalModel  →  "anthropic/claude-3-5-sonnet"  | "" (null)
```

跨 workspace 共享，不需要 workspaceId 索引。

### Resolver（替换原来的 4 层 fallback）

```ts
const selectedSessionModel = createMemo<ModelRef | null>(() => {
  const g = globalModel();
  if (g && isModelStillAvailable(g)) return g;
  return null;  // 让 UI 决定显示什么空态
});
```

注意点：
- **不再回退到** `lastUserModelFromMessages` / `sessionModelById` —— 旧 session 的历史 model 不再影响 chip 显示
- **不再回退到** `firstConnectedProviderModel` —— 全局没设过就是没设过，UI 显式提示用户选
- **不再回退到** 硬编码 `DEFAULT_MODEL` —— 保留常量但仅用于内部测试桩，UI 路径不依赖它
- `isModelStillAvailable` 检查 provider 仍连接 + model 仍存在；不再可用时清空，触发 "Choose model" 空态

### Label / 空态三档

```ts
const selectedSessionModelLabel = createMemo(() => {
  if (!providerConnectedIds().length) return t("session.model_empty_no_provider");  // "Add provider"
  const model = selectedSessionModel();
  if (!model) return t("session.model_empty_choose");                                // "Choose model"
  return formatModelLabel(model, providers());
});
```

点击 chip 的 handler：

```ts
function onModelChipClick() {
  if (!providerConnectedIds().length) {
    return openProviderAuthModal({ returnFocusTarget: "composer" });  // 已存在
  }
  openSessionModelPicker({ returnFocusTarget: "composer" });
}
```

### applyModelSelection 简化

```ts
function applyModelSelection(next: ModelRef | null) {
  setGlobalModel(next);
  // localStorage 通过 effect 自动写
}
```

不再需要：
- `pendingSessionModel` signal（创建 session 时直接读 globalModel）
- `sessionModelOverrideById` signal
- `sessionModelById` signal（如下面"消息发送时仍取当前 globalModel"所述，提取历史 model 也不需要了）
- `parseSessionModelOverrides` / `serializeSessionModelOverrides`
- localStorage key `aurowork.sessionModels.<workspaceId>`（迁移见下）

### 发送消息时的 model

新消息发送时取 `globalModel()` 当前值。发完不动 globalModel——除非用户点 picker 主动改。

### Variant（保持现状）

`modelVariantMap` 按 `provider/model` 维度的逻辑不动。`globalModel` 切换后，variant 自动按新 model 的 key 取出来即可。

## 数据迁移

旧 key：`aurowork.sessionModels.<workspaceId>`，按 sessionId 索引。

迁移策略（一次性，启动时跑一遍）：

```ts
function migrateLegacySessionModels() {
  // 扫所有以 "aurowork.sessionModels." 开头的 key
  // 选最近被使用的 sessionId 对应的 model（按某种 heuristic，比如取第一个非空值）
  // 写入 aurowork.globalModel
  // 删掉所有旧 key
}
```

如果用户没有任何旧记录 → globalModel 保持 null → 走 "Choose model" 空态。

> 替代方案：不迁移，老用户启动时全局 model 为空，直接看到 "Choose model"。**更干净**，但可能让老用户觉得"被重置了"。建议**做迁移**，无声地拿一个合理初值。

## 旧 session 体验的明确取舍

打开一个 2 周前的 session，里面的消息都是用 GPT-4 发的，但用户当前 globalModel 是 Claude：

- chip 显示 **Claude**
- 用户继续发送 → 用 Claude 发送
- 历史消息里的 GPT-4 标签（消息层级）保持不变（那是 audit trail）

这是确认过的设计选择，**不是 bug**，可能在文档/UI hint 里说一句。

## 受影响代码（精确清单）

### `app.tsx`

**删除**：
- `pendingSessionModel` 相关（信号 + 所有读写）
- `sessionModelOverrideById` 相关
- `sessionModelById` 相关（确认所有引用都不用了再删）
- `lastUserModelFromMessages` 在 model resolver 里的引用（函数本身保留，可能其他地方用）
- `firstConnectedProviderModel` 在 model resolver 里的引用（函数保留，可能用于其他地方）
- `parseSessionModelOverrides` / `serializeSessionModelOverrides`

**新增/修改**：
- `globalModel` signal + localStorage 双向同步 effect
- `selectedSessionModel` memo 改为只读 globalModel
- `selectedSessionModelLabel` memo 三档分支
- `applyModelSelection(next)` 简化为单行
- `onModelChipClick` handler（在 composer 里调或包一层）
- 启动时跑一次 `migrateLegacySessionModels`

### `context/session.ts`

- 删除 `SessionModelState` type 或简化（如果其他地方还引）
- 删除 `selectSession` 里 `lastUserModelFromMessages` → `setSessionModelById` 这条线

### `composer.tsx` / `session.tsx`

- model chip 接受新 props：`onModelChipClick`（统一入口）+ `modelLabel`（已有 `selectedModelLabel`）
- 不再区分 "showProviderHint" 和 "model picker" — 由 `onModelChipClick` 统一分发

### `model-picker-modal.tsx`

- 不变

### i18n（`en.ts` + `zh.ts` 等）

新增 key：
- `session.model_empty_choose` → "Choose model" / "选择模型"
- `session.model_empty_no_provider` → "Add provider" / "添加 provider"

## 测试要点

| 场景 | 期望 |
|---|---|
| 全新安装，没连过 provider | chip 显示 "Add provider"，点击 → Provider Auth Modal |
| 连了 provider 但没选过 model | chip 显示 "Choose model"，点击 → Model Picker |
| 选了 Claude 后切到另一个 workspace | 仍是 Claude（跨 workspace 共享） |
| 选了 Claude 后打开 2 周前的 GPT-4 session | chip 显示 Claude，下一条消息用 Claude 发 |
| 在 session A 切到 GPT-4 → 切到 session B | session B 的 chip 也是 GPT-4 |
| 选的 provider 被 disconnect | 自动清空 globalModel，chip 落到对应空态 |
| 选了 Claude，重启应用 | 仍是 Claude（localStorage） |
| 老用户升级（有旧 sessionModels 记录） | migrate 取一个合理初值，不打扰 |
| variant 切到 Claude reasoning=high → 切其他 model → 切回 Claude | reasoning 仍是 high（保持现状） |

## 不做的事

- ❌ 不做 per-workspace 全局（用户明确选了"全应用"）
- ❌ 不做"打开旧 session 自动恢复历史 model"（已确认显示全局）
- ❌ 不动 model variant 的存储维度
- ❌ 不动 provider 连接 / OAuth 流程
- ❌ 不动 workspace 配置文件 `.opencode/opencode.json` 里的 model 字段（那是 workspace 默认，跟应用层 globalModel 分开）

## 风险点

1. **旧 session 的"continue conversation"行为**：旧 session 用 GPT-4，用户继续发用了 Claude。Claude 看到的历史里 assistant 是 GPT-4 写的——上下文还在，但风格可能跳变。这是设计选择，不是技术 bug。
2. **provider 突然断开**：要确保 `isModelStillAvailable` 检查存在并被触发，否则 globalModel 可能指向不存在的 model 导致发送失败。建议在每次 `providerConnectedIds()` / `providers()` 变化时跑一次检查。
3. **migrate 选错初值**：尽量保守——如果 heuristic 不确定，宁可留空让用户重选，也别瞎选一个用户不想要的。

## 开发顺序

1. 加 `globalModel` signal + localStorage 同步
2. 改 `selectedSessionModel` resolver、label、chip click handler
3. 加 i18n
4. 加 migrate
5. 删旧 state 和无用代码
6. 手动验证测试要点（10 条）
7. PR
