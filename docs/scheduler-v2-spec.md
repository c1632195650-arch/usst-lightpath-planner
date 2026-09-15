# 排程引擎 v2 · 技术规格书（Implementation Spec）

> **文档定位**：本文件是「排程引擎 v2」的**唯一实现依据**。面向后续迭代与 AI Agent，要求「照着做就能落地」。
> **上游输入**：`排程引擎-考虑因素汇总.md`（现状盘点）+ 本文件（目标设计与实施规格）。
> **基线**：现有引擎 `src/lib/planner/*`，基线 commit `cb3f39e`(dev)。核对日期 2026-09-14。
> **状态**：Draft v1.2 —— **P0 已完成并推送**（分支 `feat/planner-v2-p0` @ `22bdee88`，含 `8b29816` + 规格书文档提交；PR #2）。P0 以「契约隔离」落地：新类型只定义在 `src/lib/planner/model.ts`，**未改动** `src/types.ts`。P1 将**一次性**落 4 项契约改动（T1.0，见 §12.5.1），此后不再动契约。
> **与 `docs/engine-plan.md` 的关系**：该文件（CY，2026-09-11）与本文件在 4 处给出不同落法。逐条对照与裁决请求见 **§12.3**；CY 的最终裁决与契约边界见 **§12.5**。
> **契约裁决已闭环**：CY 于 2026-09-15 给出裁决（`LockLevel` 等 4 项落 `types.ts`，其余留 `model.ts`），已固化进 **§12.5**，并据此修订 §3.3 / §4.1 / §4.4。
> **读者**：协作者 B（本仓库 `src/lib/`、`src/features/week/` 负责人）、CY（`src/types.ts` 契约层负责人）、后续接手的 Agent。

---

## 0. 速览（TL;DR）

| 项 | 结论 |
|---|---|
| **一句话目标** | 把引擎从「顺序即优先级的贪心流水线」升级为「**约束模型 + 加权目标 + 两段式求解（构造 → 改进）**」 |
| **四条支柱** | ① 交期进入决策 ② 产能/负荷显式化 ③ 切换成本完整化 ④ 增量 + 滚动视野 |
| **不可动摇的纪律** | 纯函数、确定性、可解释（`reason`/`notes`/`issues`）、零新增依赖 |
| **分三期** | P0 数据与交期（低风险高回报）→ P1 求解器重构 → P2 动态能力 |
| **最大空白** | 交期数据（`DEADLINES[]`、`Course.examDate`）已存在却未进入排程；地点靠关键字猜测 |

---

## 1. 目标与范围

### 1.1 目标

1. **贴合实际条件**：排程结果必须建立在显式的地点表、营业时段、交期约束之上，而不是隐式猜测。
2. **时间安排合理**：通过加权目标函数权衡「自习量 / 留白 / 通勤风险 / 认知切换 / 计划稳定性」，而非固定顺序硬扣。
3. **结果切实可行**：硬约束零违反（块不重叠、通勤留足、营业时段内、依赖满足）。
4. **可迭代、可解释、可测试**：任何改动都能量化验收，每个决策仍能对用户说出理由。
5. **动态可用**：支持增量重排、三级锁、滚动视野，能响应课表变更与突发事件。

### 1.2 范围（In Scope）

- 单周排程与跨周滚动排程（周计划为单位）。
- 交期驱动的优先级（EDF + 紧迫度函数）。
- 产能/负荷建模（每日容量、连续块上限、跨天疲劳）。
- 切换成本（空间通勤 + 认知切换）。
- 三级锁（hard/soft/free）与最小扰动增量重排。
- 领域模型的显式化（地点表、提交项、依赖、权重）。

### 1.3 非目标（Out of Scope，明确不做）

- 多人/多主体协同排程（本引擎是单用户）。
- 教室/场馆的真实占用冲突（依赖第三方排课系统，不实现）。
- 真实路网计算本身（仍由注入的 `TransferProvider` 提供，本引擎只消费）。
- LLM 意图解析（「下周三交实验报告」→ 结构化 `Commit` 属于意图层，不在本引擎内）。
- 前端 UI 实现（本文件只规定引擎侧接口与产出）。

### 1.4 成功判据（顶层）

- 硬约束违反数 = **0**（在有效输入前提下）。
- 目标函数值 **不劣于** 现有贪心引擎（同一输入下 `cost_v2 <= cost_greedy`）。
- 软目标达成率（自习、留白）**不低于**现有引擎。
- 确定性：同输入 + 同配置 → 逐字节相同输出（含块 id）。
- 单周求解耗时（P1 目标）≤ **200ms**（在 27 模板 / 20 课规模下）。

---

## 2. 术语表

| 术语 | 含义 |
|---|---|
| **时间块 Block** | 时间轴上的一个不可分割占用单元，对应输出 `TimeBlock` |
| **资源 Resource** | 时间轴（一天）与地点（POI）；食堂/自习点/操场均是地点资源 |
| **容量 Capacity** | 某天可用于安排软块（活动/自习）的净分钟数 |
| **负荷 Load** | 已排入软块占用的分钟数 |
| **交期 Due** | 提交项的截止时刻（周次 + 星期 + 分钟） |
| **紧迫度 Urgency** | 由交期与剩余产能推导的 0–1 权重 |
| **切换成本 Switch Cost** | 相邻两块之间更换地点/科目带来的时间与认知代价 |
| **锁级别 LockLevel** | `hard`（钉死）/`soft`（可动但有扰动惩罚）/`free`（自由）|
| **构造阶段 Construct** | 快速生成一个**必然可行**的初始解 |
| **改进阶段 Improve** | 在初始解上用邻域算子迭代降低 `cost` |
| **扰动 Churn** | 新旧计划之间的差异量（用于「最小扰动」） |
| **滚动状态 RollingState** | 周与周之间传递的累积负荷/临近交期/疲劳 |
| **黄金基线 Golden Baseline** | 现有引擎在固定输入下的输出快照，用作回归对照 |

---

## 3. 整体架构与模块划分

### 3.1 分层架构

```
┌─────────────────────────────────────────────────────────────┐
│  输入层  PlanRequest                                          │
│  课表 · 画像/场景 · 提交项(含交期) · 地点表 · 权重             │
│  · TransferProvider · 上一版计划 · fromNow · RollingState     │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  建模层  model.ts                                             │
│  变量(待排块) / 硬约束 / 软约束(带权重) / 目标函数装配         │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  求解层  solver.ts = construct.ts → improve.ts                │
│  ① 构造：EDF + 贪心（复用旧 7 步）→ 保底可行解                │
│  ② 改进：LNS/爬山（relocate/swap/reassign/resplit）→ 降 cost  │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  增量层  incremental.ts（脏区域计算 + 局部重排）              │
│  滚动层  roll.ts（RollingState 传递）                         │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  解释层  explain.ts  →  reason / notes / issues / diagnostics │
└───────────────────────────┬─────────────────────────────────┘
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  输出层  PlanResult = { plan: WeekPlan, notes, diagnostics }   │
└─────────────────────────────────────────────────────────────┘
```

**关键设计决策**：构造阶段**复用现有 7 步贪心的实现**（其价值是「必然可行 + 可测」），把新能力几乎全部放进「改进阶段 + 建模层」。这样能最大化复用既有测试资产，并让回归对照（golden baseline）天然成立。

### 3.2 模块清单与责任人

| 模块 | 新增/改造 | 职责 | 归属 | 备注 |
|---|---|---|---|---|
| `planner/model.ts` | 新增 | 领域模型类型 + 装配校验 | B | **不放进 `types.ts`**，避免动契约层 |
| `planner/objective.ts` | 新增 | 代价计算与目标函数 | B | 纯函数 |
| `planner/construct.ts` | 新增（迁移） | 构造阶段（EDF + 旧贪心） | B | 由现有 `schedule.ts` 抽出 |
| `planner/improve.ts` | 新增 | 邻域算子 + 接受准则 | B | 纯函数（固定种子/纯爬山） |
| `planner/solver.ts` | 新增 | 编排 construct→improve→explain | B | 对外主入口 |
| `planner/incremental.ts` | 新增 | 脏区域 + 增量重排 | B | P2 |
| `planner/roll.ts` | 新增 | RollingState 传递 | B | P2 |
| `planner/explain.ts` | 新增 | reason/notes/issues 生成 | B | 由旧逻辑抽出 |
| `planner/places.ts` | 新增 | 地点表加载 + `Place.id` 解析 | B | 替代 `campusOfName` |
| `planner/index.ts` | 新增 | 对外入口 `planWeekV2` | B | 兼容层 |
| `planner/schedule.ts` | 保留 | 旧引擎（golden baseline） | B | **不删**，供对照与灰度 |
| `lib/planner/transfer.ts` | 改造 | 两趟法 → 迭代到不动点 | B | P2 |
| `types.ts` | **不动** | 全局契约 | A(CY) | 如需改动走双方确认 |
| `features/week/*` | 改造 | 消费 `PlanResult` | B | P2 收尾 |

### 3.3 依赖方向（禁止反向依赖）

```
types.ts（契约层：LockLevel / TimeBlock.lockLevel / PlanIssue.code / PlanPersistState）
     ↑ 单向被依赖，永不被 import 回来
index.ts → solver.ts → { construct.ts, improve.ts, objective.ts, explain.ts }
                          ↘ model.ts ← places.ts
incremental.ts → solver.ts（复用求解，不做平行实现）
roll.ts → model.ts
objective.ts / explain.ts → 不得 import 任何 *Client.ts（网络层）
```

**红线**：`objective.ts`、`improve.ts`、`construct.ts` 均为**纯函数**，**禁止** `fetch`、读时钟、`Math.random`（随机种子必须由入参注入）。

**🔴 例外与唯一允许方向（2026-09-15 契约裁决，见 §12.5）**：`LockLevel` 落在 `types.ts`，因为 `AppState.locks: Record<string, LockLevel>` 需要它在契约层可见；若把 `LockLevel` 定义在 `model.ts`，`types.ts` 就必须 `import` `model.ts`，**违反本条「禁止反向依赖」**。故：

```ts
// src/types.ts —— 定义（唯一真源）
export type LockLevel = 'hard' | 'soft' | 'free';

// src/lib/planner/model.ts —— re-export，不得另行定义
export type { LockLevel } from '@/types';
```

即：`model.ts → types.ts` 的单向依赖**允许**（`model.ts` 是消费方）；`types.ts → model.ts` 的依赖**永久禁止**。

---

## 4. 关键数据结构与接口定义

> **契约归属（2026-09-15 裁决，详见 §12.5）**：以下类型分两类——
> - **落 `src/types.ts`**（契约层，改动需 CY + B 双方确认）：`LockLevel`、`TimeBlock.lockLevel?`、`PlanIssue.code?`、`PlanPersistState`。
> - **留 `src/lib/planner/model.ts`**：`Commit` / `Place` / `Weights` / `SolverConfig` / `PlanRequest` / `PlanResult` / `Diagnostics` / `RollingState`。
>
> 下文 §4.1 起为便于阅读，仍按逻辑分组给出全部定义；**每个类型标注了归属**，实现时请以标注为准。

### 4.1 基础扩充类型

**契约层部分**（落 `types.ts`）：

```ts
// ── src/types.ts ──
/** 锁级别（替换旧布尔 locked；旧字段保留以兼容 UI） */
export type LockLevel = 'hard' | 'soft' | 'free';

export interface TimeBlock {
  // …既有字段…
  /** 用户确认过的块：重排时锁定不动 */
  locked?: boolean;
  /** 三级锁；缺省视为 'free'（P1-T1.5 启用） */
  lockLevel?: LockLevel;
  /** 来源事件 id（校历事件展开的准备块用，P1 不启用） */
  fromEventId?: string;
}

export interface PlanIssue {
  // …既有字段…
  /** 机器可读的问题码；前端不得靠中文 message 匹配 */
  code?: PlanIssueCode;
}

export type PlanIssueCode =
  | 'transfer.missing_place'      // 相邻块缺地点，通勤算不出
  | 'transfer.tight'              // 通勤余量偏紧
  | 'transfer.late'               // 通勤来不及
  | 'data.unverified'             // 数据未核实（营业时段为推算值）
  | 'data.place_unregistered'     // 地点未登记在 places
  | 'capacity.overload'           // 当日负荷超容量
  | 'due.overdue'                 // 交期已过
  | 'due.insufficient_capacity';  // 交期邻近但产能不足
```

**引擎侧部分**（留 `model.ts`）：

```ts
// ── src/lib/planner/model.ts ──
import type {
  BlockKind, CampusId, Course, DayOfWeek, PhasePolicy, PlanIssue, LockLevel,
  ScenarioFields, Schedule, TimeBlock, WeekPlan, PersonaProfile,
} from '@/types';

// LockLevel 从契约层 re-export（唯一真源在 types.ts，禁止在此另行定义）
export type { LockLevel } from '@/types';
```

> ⚠️ **术语统一**：`LockLevel` 一律指三级锁 `'hard' | 'soft' | 'free'`；旧布尔字段 `TimeBlock.locked` 保留仅为 UI 兼容，**引擎内部判定一律走 `lockLevel`**，`resolveLockLevel()` 负责把 `locked:true` 映射为 `'hard'`。

**引擎侧其余基础类型**（继续留 `model.ts`）：

```ts
/** 可用时段窗（复刻 ActivityWindow 语义，避免跨模块依赖） */
export interface Window { startMin: number; endMin: number; label?: string }

/** 显式地点表条目 —— 取代 campusOfName 关键字猜测 */
export interface Place {
  id: string;            // 稳定主键，如 'poi-lib-main'
  name: string;          // POI 名，如 '图书馆（图文信息中心）'
  campus: CampusId;      // 显式校区
  hours: Window[];       // 营业/可用时段；空数组 = 不限
  category?: string;     // meal / study / sport / life ...
}
```

### 4.2 提交项（交期的载体）

```ts
/** 一个「需要被安排的事」——任务的统一抽象，取代裸 UserTask */
export interface Commit {
  id: string;
  title: string;
  emoji?: string;
  kind: BlockKind;                 // 默认 'activity'
  /** 期望投入分钟（必填，用于产能核算） */
  effortMin: number;
  /** 最小可接受时长：无合适档位时的下限；缺省 = effortMin * 0.7 */
  minAcceptableMin?: number;
  /** 是否可拆分到多个空档（如「本周累计复习 4 小时」） */
  splittable?: boolean;
  /** 交期：周次 + 星期 + 分钟；缺省 = 无硬交期 */
  dueAt?: { weekNo: number; dayOfWeek: DayOfWeek; min: number };
  /** 允许的落点窗口（如「只在晚上」） */
  window?: { fromMin: number; toMin: number };
  /** 首选地点（Place.id） */
  placeId?: string;
  /** 基础优先级（缺省 90，用户意图优先于系统建议） */
  priority?: number;
  /** 依赖：这些 Commit.id 必须先完成 */
  deps?: string[];
  /** 生效周次；空/缺省 = 全学期 */
  weeks?: number[];
  /** 是否固定：给了固定时间则为固定块 */
  pinned?: { dayOfWeek: DayOfWeek; startMin: number };
}

/** 前后依赖约束（由 Commit.deps 展开成边，便于拓扑处理） */
export interface Precedence {
  before: string;   // Commit.id
  after: string;    // Commit.id
  minGapMin?: number; // 两者之间的最小间隔（默认 0）
}
```

### 4.3 权重与配置

```ts
/** 目标函数权重（全部非负；工程默认值见 §6.3） */
export interface Weights {
  studyShortfall: number;  // 自习未达标惩罚（每分钟）
  blankDeficit: number;    // 留白不足惩罚（每分钟）
  switchCost: number;      // 认知切换惩罚（每次换科目/地点）
  transferRisk: number;    // 通勤风险惩罚（每次紧张/超时）
  dueOverdue: number;      // 交期违约惩罚（每个违约项 × 违约天数）
  churn: number;           // 计划扰动惩罚（每变动分钟）
  placeMismatch: number;   // 跨校区/未登记地点惩罚
}

/** 求解器配置 */
export interface SolverConfig {
  solver: 'greedy' | 'lns';    // 灰度开关；默认 'lns'
  seed?: number;               // 随机种子；缺省 = 确定性纯爬山
  maxIterations?: number;      // 默认 2000
  budgetMs?: number;           // 时间预算上限，默认 200
  acceptWorse?: boolean;       // 是否允许接受劣解跳出局部最优，默认 false
}
```

### 4.4 求解请求与结果

> ⚠️ **命名澄清（2026-09-15，见 §12.5）**：`RollingState` 与「持久化状态」**是两个不同的东西**，早期版本混用同一名字，容易在实现时把「跨周疲劳模型」和「存进 localStorage 的东西」写成一个类型。现拆为：

```ts
/* ── 引擎侧（model.ts）── */
/** 滚动状态：周与周之间传递的**负荷与疲劳模型**。只活在引擎内存里。 */
export interface RollingState {
  /** 最近 N 天的实际负荷（分钟），用于疲劳建模 */
  recentLoad: number[];
  /** 未来临近的交期项（供本周参考） */
  upcoming: Array<{ id: string; title: string; dueAtWeek: number; urgency: number }>;
  /** 每星期几的历史负荷均值，用于容量曲线 */
  loadByDow: number[];
}

/* ── 契约侧（types.ts）── */
/** 持久化状态：写进 AppState / localStorage 的那份。 */
export interface PlanPersistState {
  /** 状态版本号，供迁移用（当前 1） */
  version: number;
  /** 上次排程的周次；null = 从未排过 */
  lastPlanWeek: number | null;
  /** blockId → 锁级别（三级锁的持久化载体） */
  locks: Record<string, LockLevel>;
  /** 上一周传来的滚动状态；null = 首次排程 */
  rolling: RollingState | null;
  /** 累计扰动分钟数（用于「最小扰动」目标与 UI 提示） */
  churnMin: number;
  /** 最后更新时间（ISO），用于判断状态新鲜度 */
  updatedAt: string;
}
```

> ⚠️ **`rolling` 不能省**：`RollingState` 的 `recentLoad` / `loadByDow` / `upcoming` 是「变化三 · 一周很累下一周自动松一点」的**唯一数据载体**。若 `PlanPersistState` 只存 `locks` + `churnMin` 而不存 `rolling`，跨周疲劳在 P2 会没有数据来源。

```ts
/* ── 引擎侧（model.ts）── */
export interface PlanRequest {
  // —— 必需 ——
  schedule: Schedule;
  weekNo: number;                       // 1-based
  policy: PhasePolicy;
  commits: Commit[];

  // —— 可选 ——
  persona?: PersonaProfile | null;
  scenarios?: ScenarioFields | null;
  places?: Place[];                     // 缺省 = 由 templates 推导出的内置地点表
  transfer?: TransferProvider;          // 缺省 = campusFallbackTransfer
  weights?: Partial<Weights>;           // 缺省 = DEFAULT_WEIGHTS
  config?: Partial<SolverConfig>;
  dayStart?: string;                    // 默认 '07:00'
  dayEnd?: string;                      // 默认 '23:00'
  withMeals?: boolean;                  // 默认 true

  // —— 增量/动态（P2）——
  previousPlan?: WeekPlan;              // 上一版计划（用于 churn 与锁）
  lockLevels?: Record<string, LockLevel>; // blockId -> 锁级别
  fromNow?: number;                     // 当前分钟；给定则只排 [fromNow, dayEnd]
  rolling?: RollingState;               // 上一周传来的滚动状态
}

/** 求解诊断（面向开发者与验收，不直接展示给用户） */
export interface Diagnostics {
  solver: 'greedy' | 'lns';
  iterations: number;
  elapsedMs: number;
  cost: { total: number; parts: Record<string, number> };
  hardViolations: number;
  churnMin: number;
}

/** 计划变体（多版本）。P1 只产出 1 个，字段先占位，避免日后二次改契约。 */
export interface PlanVariant {
  /** 变体标识，如 'balanced' / 'compact' / 'relaxed' */
  id: string;
  /** 该变体对应的权重（便于比较与复现） */
  weights: Weights;
  /** 该变体的成本分 */
  cost: number;
  plan: WeekPlan;
}

export interface PlanResult {
  plan: WeekPlan;          // 结构兼容旧版（只增字段）
  notes: string[];         // 面向用户的生成说明
  diagnostics: Diagnostics;
  nextRolling: RollingState; // 传给下一周的滚动状态

  // —— 为未来留口，P1 不填（见 §12.3 D-2）——
  /** 多版本；P1 恒为 undefined 或长度 1（= 上面的 plan） */
  variants?: PlanVariant[];
  /** 每块的可替换项（blockId → 同类候选）。P1 不启用。 */
  blockCandidates?: Record<string, Array<{ title: string; placeId?: string }>>;
}
```

> **为什么 `variants` 现在就加而不等 P2**：`PlanResult` 是跨人契约面。若 P2 才加，届时 `features/week/*` 的消费代码与测试快照都要跟着改一次。现在只加**可选字段**、P1 不填，成本为零、改契约次数从 2 降到 1。
>
> **`blockCandidates` 为什么不进 `TimeBlock`**：进 `TimeBlock` 会改契约层的既有结构；放 `PlanResult` 则是纯新增，且「可替换项」本就是求解结果而非块的固有属性。

### 4.5 对外入口（唯一）

```ts
// planner/index.ts
export function planWeekV2(req: PlanRequest): PlanResult;

// 兼容旧调用（内部转调 planWeekV2，config.solver='greedy'）
export function buildWeekPlan(input: BuildWeekPlanInput): BuildWeekPlanResult;
```

### 4.6 目标函数接口

```ts
// planner/objective.ts
export interface CostContext {
  policy: PhasePolicy;
  weights: Weights;
  commits: Commit[];
  places: Map<string, Place>;
  transfer: TransferProvider;
  previousPlan?: WeekPlan;
  lockLevels: Record<string, LockLevel>;
  weekNo: number;
}

export interface CostBreakdown { total: number; parts: Record<string, number> }

/** 纯函数：给定一份计划，算出总代价与分项 */
export function evaluate(plan: WeekPlan, ctx: CostContext): CostBreakdown;

/** 局部代价增量（供改进阶段高效评估邻域） */
export function evaluateDelta(
  plan: WeekPlan, moved: TimeBlock[], ctx: CostContext,
): number;
```

---

## 5. 核心流程与逻辑说明

### 5.1 主流程

```
planWeekV2(req)
  │
  ├─ 1. 归一化输入
  │     · commits → 展开 Precedence 边；补默认值
  │     · places 建索引 Map<id, Place>；templates → 缺省 places
  │     · 校验：deps 无环（有环则报 error 并降级忽略环上依赖）
  │
  ├─ 2. 周次过滤（第一公民，沿用旧逻辑）
  │     · effectiveCourses(schedule, weekNo)
  │
  ├─ 3. 构造阶段 construct()
  │     · 硬块：课程块 → 固定 Commit(pinned) → 三餐
  │     · 软块：按 EDF（dueAt 升序 × urgency 降序）与 priority 择序，贪心填空档
  │     · 复用旧 7 步；输出 initialPlan（必然可行）
  │
  ├─ 4. 改进阶段 improve()（solver='lns' 时）
  │     · 锁定 hard 块；对 free/soft 块跑邻域算子
  │     · 接受准则：cost 下降则接受；纯爬山（默认）或 SA（acceptWorse）
  │     · 达 maxIterations / budgetMs / 无改进则停
  │
  ├─ 5. 增量裁剪（P2，有 previousPlan 时）
  │     · 计算脏区域，仅对脏区域重跑 improve
  │
  ├─ 6. 解释层 explain()
  │     · 逐块生成 reason；汇总 notes；冲突生成 issues（error/warn/info）
  │
  └─ 7. 组装 Diagnostics + nextRolling，返回 PlanResult
```

### 5.2 紧迫度函数（交期驱动核心）

```
urgency(commit, weekNo, capacityRemain):
    if commit.dueAt is null: return 0
    daysLeft = (commit.dueAt.weekNo - weekNo) * 7 + (commit.dueAt.dayOfWeek - 1)
    if daysLeft < 0:  return 1.0            # 已过期 → 最高紧迫
    # 剩余产能不足以覆盖 effort 时，紧迫度拉满
    if capacityRemain < commit.effortMin: return 0.9
    # 否则按「距交期天数」衰减
    return clamp(1 - daysLeft / 14, 0.05, 1.0)
```

**排序键（构造阶段）**：`sortKey = urgency * 1000 + priority`（降序）。即：先满足最紧迫且重要的，同紧迫度下用户优先级更高者先排。

### 5.3 产能与负荷模型

```
capacity(day)  = freeTotal(day) - round(freeTotal(day) * blankRatio)   # 沿用旧 usable
load(day)      = Σ 软块分钟（activity + study）
约束：
    load(day) <= capacity(day)                       # 硬
    maxContinuousStudy <= policy.maxBlockMin          # 硬（单块）
    Σ load(day[i] for i in 近3天) <= fatigueCap       # 软，fatigueCap = 2.5 * dailyStudyMin
跨天加成：
    若 rolling.loadByDow[day] 显著高于均值 → capacity(day) 下调 10%（软）
```

### 5.4 切换成本模型

```
switchCost(prev, next) =
    w.switchCost * ( subjectChanged(prev,next) ? 1 : 0 )
  + w.switchCost * 0.5 * ( placeChanged(prev,next) ? 1 : 0 )
  + w.transferRisk * transferPenalty(prev, next)

transferPenalty = 0                    若同地点
                = slackMin < 0 ? 10    若会迟到（硬风险）
                = slackMin < 5 ? 3     若偏紧
                = 1                    正常
```

**说明**：`subjectChanged` 由块的 `courseId` 或 `title` 关键词判定；认知切换只在「学习类块之间」计入，避免误伤三餐。

### 5.5 目标函数（装配）

```
total =   w.studyShortfall * max(0, targetStudy - actualStudy)
        + w.blankDeficit   * max(0, requiredBlank - actualBlank)
        + Σ switchCost(相邻软块对)
        + Σ transferRisk(所有相邻块对，含硬块)      # 硬块通勤风险不可容忍 → 权重极大
        + w.dueOverdue     * Σ overdue(commit)       # 见 §5.6
        + w.churn          * diffMin(previousPlan, plan) * lockFactor
        + w.placeMismatch  * Σ(跨校区或未登记地点的块数)
```

`lockFactor`：`hard` 块参与 diff 时权重 ×100（等价于禁止移动）；`soft` 块 ×1；`free` 块 ×0。

### 5.6 交期违约惩罚

```
overdue(commit) =
    若未排入且 dueAt 已过（相对 weekNo）        → 10 + daysOverdue
    若排入但在 dueAt 之后                       → 5
    若排入且在 dueAt 之前                        → 0
```

### 5.7 改进阶段的邻域算子

| 算子 | 动作 | 作用 |
|---|---|---|
| `relocate` | 把一块平移到另一个空档（不改时长） | 拉开冲突、改善通勤 |
| `swap` | 交换两块的时间位置 | 解「顺序错误」型局部最优 |
| `reassign` | 换块的地点（如食堂/自习点） | 降通勤、满足营业时段 |
| `resplit` | 合并若干碎自习块 / 拆分过长块 | 修 #2「自习碎」 |
| `reschedule-place` | 换提交项的地点/时段窗 | 满足依赖与交期 |

**邻域生成策略**：每轮随机选一个算子 + 一个非锁定块（种子固定则完全确定）。接受准则默认 **First-Improvement 纯爬山**（保证确定性）；配置 `acceptWorse: true` 时启用模拟退火（仍需注入种子）。

### 5.8 增量重排（P2）

```
dirtyRegion(previousPlan, changedInput) =
    受影响的天 + 有依赖关系的相邻天（±1）
    + 交期发生变化的 commit 所在天
仅对脏区域内的 free/soft 块重跑 improve；hard 块与脏区域外的 soft 块保持不变。
```

**最小扰动保证**：目标函数中的 `churn` 项天然惩罚变动；再叠加「只改脏区域」的双重保险。

### 5.9 两趟法收敛修复（P2）

现状问题：第一遍近似布局决定「要问哪些路对」，第二遍真实通勤改变布局 → 相邻点对集合失效。

**方案（三选一，推荐 A+B）**：
- **A. 迭代到不动点**：循环「取转场 → 重排 → 检查布局是否变化」，最多 N 轮（默认 3）或布局稳定即停。
- **B. 预取候选点对**：对同一地点集合内的所有潜在相邻对（按天分组后做地点笛卡尔积）全量预取，命中率高。
- **C. 全局 memo 缓存**：`TransferCache` 跨轮复用，未命中回退估算并标记 `reliable:false`。

---

## 6. 输入输出规范

### 6.1 输入规范（PlanRequest）

| 字段 | 必需 | 类型 | 缺省 | 校验规则 |
|---|---|---|---|---|
| `schedule` | ✅ | `Schedule` | — | `totalWeeks >= 1`；`termStart` 合法 ISO |
| `weekNo` | ✅ | number | — | `1 <= weekNo <= totalWeeks` |
| `policy` | ✅ | `PhasePolicy` | — | 各数值字段合法区间（见 §7.2） |
| `commits` | ✅ | `Commit[]` | `[]` | `effortMin > 0`；`deps` 无环 |
| `scenarios` | ❌ | `ScenarioFields \| null` | `null` | 影响运动/夜宵等触发 |
| `places` | ❌ | `Place[]` | 由 templates 推导 | `id` 唯一 |
| `transfer` | ❌ | `TransferProvider` | `campusFallbackTransfer` | 同步、无副作用 |
| `weights` | ❌ | `Partial<Weights>` | `DEFAULT_WEIGHTS` | 全部 ≥ 0 |
| `config` | ❌ | `Partial<SolverConfig>` | `{solver:'lns', maxIterations:2000, budgetMs:200}` | — |
| `dayStart/dayEnd` | ❌ | string | `'07:00'/'23:00'` | `dayStart < dayEnd` |
| `previousPlan` | ❌ | `WeekPlan` | — | 有则启用 churn |
| `lockLevels` | ❌ | `Record<string,LockLevel>` | `{}` | key 为 blockId |
| `fromNow` | ❌ | number | — | 0–1440；给定则只排其后 |
| `rolling` | ❌ | `RollingState` | 空状态 | — |

### 6.2 输出规范（PlanResult）

- `plan.blocks`：按 `dayOfWeek ASC, startMin ASC` 排序；`id` 确定性（见 §6.4）。
- `plan.stats`：`courseMin / studyMin / blankMin / blockCount`（**保持旧结构不变**）。
- `plan.issues`：`error` / `warn` / `info` 三级；每项**必须带 `code`**（见 §4.1），前端按 `code` 分支，**不得匹配中文 `message`**；硬约束违反必须为 error。
- `notes`：面向用户的过程说明（沿用旧文案风格 + 新增交期/产能说明）。
- `diagnostics`：面向开发者；不进入用户可见 UI。
- `nextRolling`：供下一周 `PlanRequest.rolling` 使用。

> **裁决（2026-09-15）**：新增的 `cost` / `churnMin` / `hardViolations` **放 `PlanResult.diagnostics`，不动 `WeekPlan.stats`**。
> 理由：`stats` 是「用户可见的时长统计」，语义窄且已被 UI 消费；`cost`/`churnMin` 是求解器内部指标，混进去会让 `stats` 的语义变浑。分开放既是纯新增（不改既有结构），也让「给用户看的数」与「给开发者看的数」边界清晰。
> 若将来 UI 确需展示质量分，从 `diagnostics.cost.total` 读，**不复制进 `stats`**。

### 6.3 默认权重（工程默认，可覆盖）

```ts
export const DEFAULT_WEIGHTS: Weights = {
  studyShortfall: 1.0,
  blankDeficit:   1.0,
  switchCost:     0.5,
  transferRisk:   2.0,
  dueOverdue:     8.0,
  churn:          0.8,
  placeMismatch:  3.0,
};
```

> 调参建议：交期敏感场景上调 `dueOverdue`；稳定性优先上调 `churn`；避免通勤优先上调 `transferRisk`。

### 6.4 确定性 id 规范

**🔴 规则（2026-09-15 修订，原 `day-kind-startMin-seq` 作废）**：

```
blockId = `w{weekNo}-d{dayOfWeek}-{kind}-{语义键}`
```

其中 `语义键` 是该块**固有身份**的稳定标识，**严禁包含时间**：

| 块类型 | 语义键 | 示例 |
|---|---|---|
| `course` | `{courseId}p{startPeriod}` | `w3-d2-course-CS101p3` |
| `user`（固定任务） | `{taskId}` | `w3-d4-user-t1742...` |
| `meal` | `{mealId}`（breakfast/lunch/dinner） | `w3-d1-meal-lunch` |
| 模板块 | `{templateId}` | `w3-d5-template-sport-01` |
| `study` | `{templateId}-{第几块}` | `w3-d1-study-lib-2` |

**为什么必须去掉 `startMin`（这是 P1 的前置条件，不是可选项）**：

`churn`（扰动代价）与 `lockLevels`（锁）都靠 **id 匹配「同一个块」**。若 id 含 `startMin`，则块被移动后 id 跟着变 → 引擎会把它判成「删了一个 + 新增一个」，导致：

1. `churn` 虚高：明明只是平移 30 分钟，却被计为一次删除 + 一次新增，扰动代价翻倍；
2. **锁彻底失效**：`locked` 的语义是「这个块换时间后还是它自己」，id 一变就锁不住 → 三级锁与「变化一 · 确认过的安排不会再跑掉」从根上建不起来。

`improve` 阶段移动块时**保留原 id**（仅位置变），便于 diff 与前端 key 稳定。同输入 + 同 config → id 完全一致。

> ⚠️ **与旧引擎的差异**：`schedule.ts` @ `8b29816` 仍是旧规则 `day-kind-startMin-seq`。P1-T1.1 抽 `construct` 时，**同步按本条改为语义键**，并以改后的输出拍一次 golden baseline。此事已与 CY 对齐（见 §12.5 / §12.3 D-5）。

---

## 7. 依赖与前置条件

### 7.1 环境与工具链

| 项 | 要求 |
|---|---|
| 运行时 | Node 22.22.2（managed） |
| 包管理 | npm（无新增依赖） |
| 构建门禁 | `npm run typecheck`（`npm run build` 在沙箱会被删文件守卫拦截，**不作为门禁**） |
| 测试 | 无测试框架 → 用 Node 原生类型剥离 + 别名钩子（见 §7.3） |
| Python 侧 | 课表解析服务 `timetable_parser`（独立目录，本引擎不直接依赖） |

### 7.2 前置约束（必须遵守）

1. **零新增依赖**：约束禁止引新依赖；PDF 相关只允许 `pdfjs-dist`（与本引擎无关）。
2. **`src/types.ts` 是锁死契约**：本规格的所有新类型放 `planner/model.ts`；确需改契约须 CY + B 双方确认。
3. **文件所有权**：本引擎模块均属 B 的地盘（`src/lib/`）；改动他人文件前先打招呼。**2026-09-15 补充**：新建 `tests/` 归 B；`src/lib/planner/**` 新增文件全部归 B；由 CY 更新 `AGENTS.md` 所有权表 + `docs/progress-status.md` 文件地图。
4. **一次只做一个阶段**：P0 做完跑通再进 P1（协作红线）。
5. **不在主仓库执行 `git stash`**；日常 git 建议用户在自带终端（`D:\program file\Git`）操作。
6. **`PhasePolicy` 数值区间**：`dailyStudyMin ∈ [0, 600]`；`maxBlockMin ∈ [20, 240]`；`blankRatio ∈ [0, 0.9]`。
7. **合入顺序（2026-09-15 裁决）**：CY 先 `rebase` 到 `22bdee88` → 撤回 `types.ts` 的 `TimeBlock.fromEventId`（改到 `model.ts` 扩展）→ 提 PR 到 `dev`（分支 `feat/events-and-diversity`）；B review 合入后，**再**基于合并后的版本抽 `construct`（T1.1）+ 拍 golden baseline（**只拍一次**）。

### 7.3 零依赖单测跑法（已在本机验证）

**位置已入仓（2026-09-15 裁决，见 §12.5）**：钩子从仓库外 `_devtools/` 移入仓库 `tests/`，与 CY 的 `scripts/`（数据工程）分开，归 B。

```bash
# 引擎测试（v2 求解器）
node --import ./tests/register.mjs --test "tests/**/*.test.ts"

# CY 侧既有数据工程测试（维持原路径不搬家，仅换运行方式）
node --import ./tests/register.mjs --test "scripts/**/*.test.ts"
```

- 钩子 `tests/register.mjs` + `tests/alias-hook.mjs` 把 `@/x` 解析到 `src/x.ts`。
- ⚠️ `src/lib/api.ts` 使用 `import.meta.env`，**Node 里加载不了**；因此任何 `import` 了 `api.ts` 的模块（如 `planner/transfer.ts`）不能直接被测试加载。测试 v2 求解器时，**用桩 provider 注入**，不要 import `transfer.ts`。
- ⚠️ **禁止引入 `tsx` / `ts-node` 等运行器**（零新增依赖纪律）。Node 22 原生类型剥离 + 别名钩子已覆盖此需求。

### 7.4 数据前置

| 数据 | 来源 | 现状 |
|---|---|---|
| 地点表 | `data/campus_map.json`（146 POI） | 需补显式 `campus` 与核实 `hours` |
| 营业时段 | `templates.ts` 的 `windows` | 南校食堂标「（估）」需核实 |
| 节次表 | `constants/time.ts` | 与项目记忆有冲突，以 time.ts 为准，待回教务复核 |
| 交期 | `data/usst.ts` 的 `DEADLINES[]`、`Course.examDate` | **已存在，待接入** |
| 学期校历 | `constants/term.ts` 的 `TERM_CALENDAR` | 每学年需补一条；**含 `phases` / `holidays`（假期与考试周边界），直接复用，勿另开通道**（2026-09-15 更正） |

---

## 8. 约束与边界情况处理

### 8.1 硬约束（违反 = 不可行 / error）

| # | 约束 | 检测点 | 违反处理 |
|---|---|---|---|
| H1 | 同一时刻不得有两个块 | `overlaps()` | 课程冲突 → error；求解器应优先消解 |
| H2 | 地点变化必须留足通勤 | `travelNeed()` | 求解器强制预留；残留 → warn/error |
| H3 | 三餐落在营业时段内且两头留缓冲 | `openAt()` + `MEAL_BUFFER_MIN` | 排不进 → info |
| H4 | 可排区间 `[dayStart, dayEnd]` | 构造期 | 越界块丢弃 |
| H5 | 活动模块校区匹配当天校区（custom 除外） | `placeTemplate` | 不匹配 → 该天不入候选 |
| H6 | `CATEGORY_PER_DAY` 限额 | 构造期 | 超限跳过 |
| H7 | 依赖先后（Precedence） | 拓扑校验 | 环 → error 并忽略环上依赖 |
| H8 | `hard` 锁块位置不可动 | improve 阶段 | 从邻域中排除 |

### 8.2 边界情况清单

| 场景 | 期望行为 |
|---|---|
| 本周 0 门课 | note「整天可自己安排」；正常排软块 |
| 课程缺地点（`building` 为空） | **不**按 0 分钟算通勤；出 `info`「地点缺失，通勤无法计算」；该块不参与 `transferRisk` |
| 地点未登记在 `places` | 出 `info` 并标 `placeMismatch` 惩罚；**不回退关键字猜测** |
| 交期早于当前周（已过期） | `urgency = 1.0`；违约计入 `dueOverdue`；note 提示 |
| 交期在考试周之后 | 视为软交期，仅低权重参考 |
| `fromNow` 落在某块中间 | 该块若为 hard 保留原样；soft 块截断或重排 |
| `previousPlan` 与当前输入冲突 | 以当前输入为准；冲突块按 `lockLevels` 决定去留 |
| 周末且 `!weekendWork` | 生活类块保留，自习不排（沿用旧逻辑） |
| `!eveningAllowed` 但有晚课（11–13 节） | 课程块照排；notes 文案改为「引擎**不主动**占用晚间」，避免自相矛盾（修旧 #18） |
| 依赖成环 | error + 忽略环上依赖，不崩溃 |
| 改进阶段无改进 | 直接返回构造解，`diagnostics.iterations` 记实际轮数 |
| `transfer` 抛错 | 捕获 → 回退 `campusFallbackTransfer` → 标 `reliable:false` |
| 权重中有负数 | 校验报 error，回退 `DEFAULT_WEIGHTS` |

### 8.3 已知旧问题 → 本规格对应条目

| 旧 # | 现象 | 本规格解决于 |
|---|---|---|
| 1 | 贪心无回溯、局部最优 | §5.7 改进阶段 |
| 2 | 活动抢空档致自习碎 | §5.7 `resplit` |
| 3 | 冲突只报不修 | §8.1 H1 + improve 消解 |
| 4 | 硬/软二值无权重 | §5.5 目标函数 |
| 5 | 无依赖约束 | §4.2 `Commit.deps` + H7 |
| 6 | 无交期 | §5.2 + §5.6 |
| 7 | 优先级静态 | §5.2 `sortKey` |
| 8 | 时长档位欠/过配 | §4.2 `minAcceptableMin` |
| 9 | 地点靠关键字猜 | §4.1 `Place` + §8.2 |
| 10 | 无最小间隔/连续约束 | §5.3 |
| 11 | 全量重排 | §5.8 增量 |
| 12 | 只有全锁/全放 | §4.1 `LockLevel` |
| 13 | 无跨周视野 | §5.8 + `RollingState` |
| 14 | 无「从此刻起」 | `fromNow` |
| 15 | 两趟法不收敛 | §5.9 |
| 16 | 数据质量 | §7.4 |
| 17 | 缺地点按 0 算 | §8.2 |
| 18 | UI 文案矛盾 | §8.2 |
| 19 | 转场后端失败静默 | §8.2 |

---

## 9. 分步骤实现要点（Agent 可执行清单）

> **执行纪律**：一次只做一个任务（Task）；每个任务完成即跑 `typecheck` + 该任务的验收脚本；通过后再接下一个。
>
> ⚠️ **契约前置（2026-09-15 裁决后修订）**：T1.1 **会**触碰 `types.ts`（`LockLevel` 落契约层，见 §12.5.1），故 **T1.1 开工前须先与 CY 确认该 4 项契约改动**。除此之外，P1 其余任务不改契约。
>
> ⚠️ **开工前置（合入顺序）**：T1.1 必须在 **CY 的 `feat/events-and-diversity` 合入 `dev` 之后**基于合并版本开工（见 §7.2 第 7 条 / §12.5.3）。

### P0 —— 低风险、高回报（先做）

#### T0.1 建立地点表 `planner/places.ts`
- **目标**：显式 `Place` 表，替代 `campusOfName`。
- **步骤**：
  1. 从 `templates.ts` 的模块 + `data/campus_map.json` 抽取 POI，生成 `Place[]`（`id`/`name`/`campus`/`hours`）。
  2. 实现 `buildPlaceIndex(places): Map<string, Place>` 与 `resolvePlace(nameOrId)`。
  3. 保留 `campusOfName` 仅作**过渡回退**，并在命中失败时返回 `null`（不再默认 JG516）。
- **产出**：`places.ts` + 内置 `BUILTIN_PLACES`。
- **验收**：单测列出全部 POI，断言每个都有非 `UNKNOWN` 的 `campus`；断言未登记名称返回 `null`。

#### T0.2 交期接入 + 紧迫度
- **目标**：`Commit.dueAt` → `urgency` → 构造排序键。
- **步骤**：
  1. 实现 `urgency()`（§5.2）与 `sortKey()`。
  2. `construct.ts` 中把静态 priority 排序替换为 `sortKey`。
  3. 接入 `Course.examDate` 与 `DEADLINES[]`：作为隐式 `Commit`（`kind:'study'`，`effortMin` 取估算值）或作为 urgency 加成来源（二选一，推荐后者，避免虚增任务）。
- **产出**：`objective.ts::urgency`。
- **验收**：给定「周三交报告」的 commit，断言其所在周的排序权重高于无交期同类项；断言过期项 `urgency === 1.0`。

#### T0.3 三级锁 + churn 预留
- **目标**：`LockLevel` 接入目标函数与 improve 邻域。
- **步骤**：
  1. `resolveLockLevel(blockId, lockLevels)`：缺省 `course/course`→`hard`；用户 pinned→`hard`；引擎自排→`free`。
  2. `evaluate()` 中按 `lockFactor` 计入 churn。
  3. improve 邻域排除 `hard` 块。
- **产出**：锁相关工具函数。
- **验收**：断言 `hard` 块在 improve 前后坐标不变。

#### T0.4 文案与数据治理修正
- **目标**：修旧 #16/#17/#18。
- **步骤**：① 缺地点课程出 info（不按 0 算通勤）；② 「不占用晚间」→「不主动占用晚间」；③ 南校食堂 `verified:false` 在 notes 标注。
- **验收**：构造「有晚课 + eveningAllowed=false」的输入，断言 notes 文案不自相矛盾。

### P1 —— 求解器重构（核心）

#### T1.0 契约层先行（P1 唯一改 `types.ts` 的任务）
- **目标**：按 §12.5.1 落地 4 项契约改动，之后 P1 不再碰 `types.ts`。
- **步骤**：① `types.ts` 加 `LockLevel` / `PlanIssueCode` / `TimeBlock.lockLevel?` / `PlanPersistState`；② `model.ts` 改为 `export type { LockLevel } from '@/types'`（删本地定义）；③ `AppState` 加 `planState: PlanPersistState | null`；④ `storage.ts` 迁移 v3→v4。
- **产出**：契约层 + 迁移逻辑。
- **验收**：`typecheck` 绿；旧 localStorage 数据能迁移到 v4 且不丢字段；`model.ts` 内 `grep "type LockLevel"` **零命中**（证明未重复定义）。
- **责任**：①② 由 B 提交、CY review；③④ 属 CY 地盘（`types.ts` + `storage.ts`），由 CY 实施。

#### T1.1 抽取 `construct.ts`（⚠️ 含 id 规则变更）
- 把现有 `schedule.ts` 的 7 步抽成 `construct(req, ctx): WeekPlan`。
- ⚠️ **同时把 block id 规则改为语义键**（§6.4）：`w{weekNo}-d{day}-{kind}-{语义键}`，**去掉 `startMin`**。这是 `churn` 与 `lockLevels` 能工作的前提（见 §6.4 说明）。
- **验收**：
  1. **块内容等价**：同一输入下，`construct` 输出的块集合（时间 / 类型 / 标题 / 地点）与合并后的 `buildWeekPlan` **逐块一致**；
  2. **id 已改**：断言所有 id 匹配 `^w\d+-d\d+-\w+-.+$` 且**不含任何形如 `-\d{3,4}-` 的时间片段**；
  3. 断言连续两次运行输出逐字节相同（确定性）。
- **注**：因 id 规则变更，「与旧引擎逐块一致」**仅指块内容，不含 id**——§10 中「含 id」的表述作废，以本条为准。

#### T1.2 实现 `objective.ts`
- 实现 `evaluate` / `evaluateDelta`（§5.5、§5.6、§5.4、§5.3）。
- **验收**：构造已知的优劣两版计划，断言优者 `cost` 更低；断言分项之和 = total。

#### T1.3 实现 `improve.ts`
- 实现 §5.7 五个算子 + 纯爬山接受准则（确定性）。
- **验收**：对构造解跑 improve，断言 `cost` 单调不增；断言输出确定性（连续两次运行逐字节相同）。

#### T1.4 编排 `solver.ts` + 入口 `index.ts`
- `planWeekV2` 串起 normalize → construct → improve → explain → assemble。
- 保留 `buildWeekPlan` 兼容转调。
- **验收**：`buildWeekPlan` 旧测试全绿；`planWeekV2` 硬约束违反 = 0。

#### T1.5 `explain.ts` 抽取 + 交期/产能文案
- 抽出 reason/notes/issues 生成；新增「因为 X 交期临近，本块提前」类理由。
- **验收**：每个软块都有非空 `reason`；issues 分级正确。

#### T1.6 Golden baseline 与指标
- 生成 `tests/golden/week-*.json` 快照（**合并后**的旧引擎输出，只拍一次）。
- 实现指标脚本：硬约束违反数、cost、软目标达成率、churn、耗时。
- **验收**：新引擎在全部 golden 输入上 `hardViolations=0` 且 `cost <= baseline`。

### P2 —— 动态能力与性能

#### T2.1 增量重排 `incremental.ts`
- 脏区域计算 + 局部 improve；`previousPlan` + `lockLevels` 驱动。
- **验收**：改一个 commit，断言未受影响天的块坐标不变（churn = 0）。

#### T2.2 滚动视野 `roll.ts`
- `RollingState` 生产与消费；`loadByDow` 影响 capacity。
- **验收**：连续两周求解，断言第二周拿到第一周的 `recentLoad`。

#### T2.3 `fromNow` 支持
- 只排 `[fromNow, dayEnd]`；hard 块保留。
- **验收**：`fromNow=15:00` 时，断言无 15:00 前的软块。

#### T2.4 两趟法收敛修复
- 按 §5.9 方案 A+B 改造 `transfer.ts`。
- **验收**：断言最终布局下**每一对相邻跨点都被预取**（无遗漏）。

#### T2.5 前端消费 `PlanResult`
- `features/week/*` 读取 `diagnostics`（可选展示「本次含 N 处估算通勤」）。
- **验收**：`npm run typecheck` 通过；周程页正常渲染。

---

## 10. 验收标准（Verifiable Acceptance Criteria）

### 10.1 功能验收（逐条可自动化）

| ID | 验收项 | 判定方法 | 通过阈值 |
|---|---|---|---|
| AC-1 | 硬约束零违反 | 遍历所有块对 + 通勤检查 | `hardViolations === 0` |
| AC-2 | 构造等价 | 与**合并后**的 `buildWeekPlan` 逐块比对 | **块内容 100% 一致；id 按 §6.4 新规则生成，不参与比对** |
| AC-3 | 目标函数更优 | `cost_v2` vs `cost_greedy` | `cost_v2 <= cost_greedy`（全部 golden 输入） |
| AC-4 | 交期生效 | 有交期项的排序权重 | 高于无交期同类项 |
| AC-5 | 锁生效 | `hard` 块 improve 前后 | 坐标不变 |
| AC-6 | 确定性 | 同输入两次运行 | 输出逐字节相同 |
| AC-7 | 增量最小扰动 | 改单个 commit | 未受影响天 churn = 0 |
| AC-8 | 缺口地点不误算 | 缺地点课程 | 无 0 分钟通勤、有 info |
| AC-9 | 依赖满足 | 有 `deps` 的 commit | 前驱结束 ≤ 后驱开始 |
| AC-10 | 两趟收敛 | 相邻跨点对 | 全部预取命中 |

### 10.2 性能验收

| ID | 指标 | 阈值 |
|---|---|---|
| PF-1 | 单周求解耗时（27 模板 / 20 课 / 2000 迭代） | ≤ 200ms |
| PF-2 | improve 单轮邻域评估 | ≤ 1ms |
| PF-3 | 内存增量 | 无泄漏（多次调用 RSS 稳定） |

### 10.3 质量验收

| ID | 指标 | 阈值 |
|---|---|---|
| QL-1 | 软目标达成率（自习、留白） | ≥ 旧引擎 |
| QL-2 | 可解释覆盖 | 100% 软块有 `reason` |
| QL-3 | 计划稳定性 | 相同输入 + 微扰动，churn ≤ 旧引擎 |

### 10.4 验收执行方式

```bash
# 1) 类型门禁
npm run typecheck

# 2) 零依赖验收脚本（钩子已入仓 tests/，见 §7.3）
node --import ./tests/register.mjs --test "tests/**/*.test.ts"

# 3) Golden 对照
node --import ./tests/register.mjs tests/golden-compare.ts

# 4) CY 侧既有数据工程测试（原路径不搬家，仅换运行方式）
node --import ./tests/register.mjs --test "scripts/**/*.test.ts"
```
> 另建议：为每个 Task 单独写一个 `tests/task-*.test.ts` 断言脚本，跑通即视为该 Task 验收通过。

---

## 11. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| `types.ts` 契约需变更 | 阻塞 | **已裁决（§12.5.1）**：仅 4 项进契约层，其余留 `model.ts`；T1.0 一次性完成，之后 P1 不再动契约 |
| improve 耗时不达标 | 体验 | 先纯爬山小规模验证；必要时降 `maxIterations` / 用 `budgetMs` 硬截断 |
| 权重难调 | 结果偏差 | 提供 `DEFAULT_WEIGHTS` + 单测固定若干场景做回归；权重变更有快照 |
| 数据质量（校区/时段） | 结果不可信 | P0 数据治理先行；`verified:false` 降权 + 标注 |
| 沙箱限制（每轮删 50 文件、git 写 ref 静默失败） | 构建/提交受阻 | 门禁只用 `typecheck`；git 操作交用户在自带终端执行 |
| 与旧引擎行为分叉 | 回归 | 保留 `schedule.ts` 作 baseline；feature flag 灰度 |

---

## 12. 附录

### 12.1 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-09-14 | 首版：架构 + 数据模型 + 目标函数 + 三期任务 + 验收标准 |
| v1.1 | 2026-09-14 | ① 状态更新为 P0 已完成（`8b29816`），明确「契约隔离」使 `types.ts` 对齐顺延至 P1；② 新增 §12.3 与 `docs/engine-plan.md` 的 4 处分歧对照 + 调和建议；③ 记录 `engine-plan.md` 中「`src/lib/planner/` 不存在」已过期 |
| v1.2 | 2026-09-15 | 吸收 CY 最终裁决（§12.5）：① §3.3 明确 `LockLevel` 落 `types.ts` 且仅允许 `model.ts → types.ts` 单向依赖；② §4.1 拆分契约层/引擎侧并新增 `PlanIssueCode`；③ §4.4 拆分 `RollingState`（引擎）与 `PlanPersistState`（持久化），`PlanResult` 新增 `variants` / `blockCandidates` 占位；④ §6.2 裁决 `cost`/`churnMin` 放 `diagnostics` 不动 `stats`；⑤ **§6.4 修正 block id 规则为语义键（去时间）**；⑥ §7.3 测试钩子入仓 `tests/`、明令禁用 `tsx`；⑦ §7.2 补合入顺序；⑧ §12.2 四问全部标注「已裁决」 |

### 12.2 待与 CY 确认清单（✅ 已全部裁决，2026-09-15）

| # | 问题 | 裁决 |
|---|---|---|
| 1 | `Commit`/`Place`/`LockLevel` 是否收敛进 `types.ts`？ | **`LockLevel` 进 `types.ts`**（因 `AppState.locks` 需在契约层可见，否则 `types.ts` 要 import `model.ts`）；`Commit`/`Place`/`Weights`/`SolverConfig`/`PlanRequest`/`PlanResult`/`Diagnostics`/`RollingState` **留 `model.ts`**。见 §12.5 |
| 2 | `Course.examDate` 接入引擎是否属「契约使用方变更」？ | **不算**（只读既有字段，未改结构）。`examDate → string[]` 的扩展**推迟到 P2**。见 §12.5 |
| 3 | 是否允许在 `WeekPlan.stats` 加 `cost` / `churnMin`？ | **不加。** 改放 `PlanResult.diagnostics`（纯新增、语义更清晰）。见 §6.2 |
| 4 | `src/lib/planner/` 新增文件是否全归 B？ | **归 B**；另新建 `tests/` 归 B；由 CY 更新 `AGENTS.md` 所有权表 + `docs/progress-status.md`。见 §7.2 |

> 完整裁决（含 `PlanPersistState` 字段、`studyCandidates` 冲突解法、id 规则、`tsx` 处置）见 **§12.5**。

### 12.3 与 `docs/engine-plan.md` 的分歧（需 CY 裁决）

`docs/engine-plan.md`（CY，2026-09-11）与本文件给出**不同的落法**。先说**不矛盾**的部分，避免被误读为两份互斥方案：

- 都认为排程引擎留在**前端纯 TS**、纯函数、零依赖，不放后端。
- 都认为推进顺序是**先定契约/数据，再写引擎**。
- CY 的「A. 确定性层 / B. 推荐层」分层 ≈ 本文件的「硬约束层 / 软目标层」分离，**同源思想**，可直接对齐。

以下是本文件**主动偏离** CY 原文的 4 处，请 CY 逐条给结论：

| # | 分歧点 | `engine-plan.md` 主张 | 本文件主张 | 若不统一的代价 |
|---|---|---|---|---|
| **D-1** | 新类型落位 | `Phase` / `WeekPlan` / `TimeBlock` / `PlanTask` 新增进 `src/types.ts` | `Commit` / `Place` / `LockLevel` / `Weights` 等**只定义在 `src/lib/planner/model.ts`**，且禁止 `from '@/types'` 反向导入 | 落 `types.ts`：每次改模型都要双方会签，P1 的每一步都卡在评审上；落 `model.ts`：日后若决定搬家，代价仅 1 个文件的 re-export |
| **D-2** | 单版本 vs 多版本 | 推荐层产出 **3–4 个风格不同版本**，每块带 `reason` + `candidates` | 产出**单一周计划** + 加权目标函数 + 最小扰动增量重排 | 多版本会让「锁等级 / 滚动视野 / 增量重排」语义复杂化（哪一版是基准、锁施加在哪一版？）；单版本则失去「用户自己挑一版」的兜底能力 |
| **D-3** | 模块命名 | `layout.ts`（确定性层）+ `recommend.ts`（推荐层） | 保留 `buildPhases.ts`，新增 `model.ts` / `places.ts` / `objective.ts` + 求解器 | 命名不一致 → P1 的 diff 无法按模块 review，也无法挂到同一份任务清单上 |
| **D-4** | 消费方目标与时机 | 接通 Newton 幕墙 v9，补 `WeekPlan → blocks` 适配层（≈80 行），列为**第 4 步（P1 内）** | 消费方为 `features/week/*`（§4 模块表），但排在 **P2 收尾** | 若 P1 结束时仍无任何消费方，则 P1 改完无人验证、无验收出口；若两边各接一套会产生两份适配层 |
| **D-5** | block id 规则 | 未提及 | ⚠️ **原为 `day-kind-startMin-seq`（含时间）** | id 含时间 → 块移动后 id 变 → `churn` 虚高 + **锁失效**。三级锁与「变化一」都建不起来 |

#### 分歧裁决结果（2026-09-15，CY 已答复，详见 §12.5）

| # | 裁决 |
|---|---|
| **D-1** | ✅ **不进 `types.ts`**（`LockLevel` 例外，见 §12.5）。判据：**看几个模块 import 它**，而非「它重不重要」。 |
| **D-2** | ✅ **不做整周多版本；做 `candidates`**。`PlanResult` 定形为 `{ plan, variants?, blockCandidates? }`——P1 只填 1 个，为未来留口、**改契约次数从 2 降到 1**。 |
| **D-3** | ✅ **以实际代码为准**；保留 `buildPhases.ts`（已被 `App.tsx` 引用，改名会波及 CY 的 UI 接线）。`docs/engine-plan.md` 由 CY 标注「相关段落已被 v2 规格书取代」。 |
| **D-4** | ⚠️ **情况已变**：CY 的未提交 P0 已**新建 `features/week/WeekPlanView.tsx` 并接进 `App.tsx`** —— 消费方**已存在**，不再是「幕墙 vs features/week」二选一。问题变为「该组件**留用**（改消费 `PlanResult`）还是**重做**」，需双方当面定。 |
| **D-5** | ✅ **采纳语义键规则**：`w{weekNo}-d{day}-{kind}-{语义键}`，**不得含时间**。已写入 §6.4 并列为 T1.1 前置。 |

#### 事实更新（CY 原文已过期的一处）

`engine-plan.md` §二 写「**已确认 `src/lib/planner/` 目录不存在**」——该判断在 2026-09-11 成立，现已不成立。P0 已在该目录落地 4 个模块：`model.ts`、`places.ts`、`objective.ts`、`schedule.ts`。分支 `feat/planner-v2-p0` @ `22bdee88`。

### 12.4 参考文件

- `排程引擎-考虑因素汇总.md`（现状盘点，核对 commit `cb3f39e`）
- `usst-lightpath-planner/src/lib/planner/schedule.ts`（旧引擎，golden baseline）
- `usst-lightpath-planner/src/lib/planner/buildPhases.ts`（阶段策略）
- `usst-lightpath-planner/src/lib/planner/templates.ts`（模块库 → places 来源）
- `usst-lightpath-planner/src/lib/planner/transfer.ts`（两趟法）
- `usst-lightpath-planner/src/types.ts`（锁死契约）
- `usst-lightpath-planner/src/data/usst.ts`（DEADLINES，交期数据源）
- `usst-lightpath-planner/src/constants/term.ts`（`TERM_CALENDAR`：假期 / 考试周边界，**已有数据，勿另开通道**）
- `usst-lightpath-planner/src/constants/time.ts`（节次表，时间基准）
- `usst-lightpath-planner/docs/engine-plan.md`（CY 的实施顺序方案，2026-09-11；相关段落已被本文件取代，分歧见 §12.3）
- `usst-lightpath-planner/tests/register.mjs` + `tests/alias-hook.mjs`（零依赖测试钩子，**P1 起入仓**；此前在仓库外 `_devtools/`）

### 12.5 契约边界与协作指令（✅ CY 最终裁决，2026-09-15）

> 本节为**已生效**的裁决，非建议。实现时以本节为准；与上文任何旧表述冲突时，以本节为准。
> 来源：CY《光溯排程 · 体验变更说明与协作指令》§2/§3/§4。

#### 12.5.1 契约归属（最终）

**落 `src/types.ts`（契约层，改动需双方确认）——仅这 4 项：**

| 项 | 理由 |
|---|---|
| `LockLevel`（类型本身） | ⚠️ **连带要求**：`AppState.locks: Record<string, LockLevel>` 需它在契约层可见；否则 `types.ts` 必须 import `model.ts`，**违反 §3.3「禁止反向依赖」**。故定在 `types.ts`，`model.ts` 改为 `re-export`（见 §3.3） |
| `TimeBlock.lockLevel?: LockLevel` | 要持久化 + UI 展示锁状态 |
| `PlanIssue.code?: PlanIssueCode` | 前端不得靠中文 `message` 匹配（文案一改就断） |
| `PlanPersistState` | 写进 `AppState` 的持久化结构（见 12.5.2） |

**留 `src/lib/planner/model.ts`：**`Commit` / `Place` / `Weights` / `SolverConfig` / `PlanRequest` / `PlanResult` / `Diagnostics` / `RollingState`。

#### 12.5.2 ⚠️ `RollingState` 与 `PlanPersistState` 必须拆名

| 名字 | 归属 | 字段 | 用途 |
|---|---|---|---|
| `RollingState` | `model.ts` | `recentLoad` / `loadByDow` / `upcoming` | **跨周负荷与疲劳建模**（引擎内存） |
| `PlanPersistState` | `types.ts` | `version` / `lastPlanWeek` / `locks` / **`rolling: RollingState \| null`** / `churnMin` / `updatedAt` | 持久化到 `AppState` |

> ⚠️ **易错点**：`PlanPersistState.rolling` 不能省。若只存 `locks` + `churnMin`，「变化三 · 一周很累下一周自动松一点」在 P2 会**没有数据载体**。

#### 12.5.3 合入顺序（最终）

```
① CY:  git rebase 到 22bdee88（预期仅 studyCandidates 一处冲突）
② CY:  按 D-1 撤回 types.ts 的 TimeBlock.fromEventId → 改到 model.ts 扩展
③ CY:  提 PR 到 dev（分支 feat/events-and-diversity）
④ B:   review + 合入
⑤ B:   基于合并后版本抽 construct（T1.1）+ 拍 golden baseline（只拍一次）
```

#### 12.5.4 真实冲突面：只有 `studyCandidates` 一处

逐文件核对结论（CY §1.3，附 ref 与行号）：

| 文件 / 函数 | B 改了吗 | CY 改了吗 | 冲突 |
|---|---|---|---|
| `schedule.ts::newId` | ❌ | ✅ | 无 |
| **`schedule.ts::studyCandidates`** | ✅ `campusOfPlace` | ✅ `sameCampus` + `preferred/fallback` | 🔴 **会冲突** |
| `schedule.ts::campusOfName` | ✅ 返回 null | ❌ | 无 |
| `schedule.ts::placeMeal` | ✅ unverified | ❌ | 无 |
| `schedule.ts::attachTransfers` | ✅ 缺地点处理 | ❌ | 无 |
| `buildPhases.ts`（`STUDY_PLACES`） | ❌ | ✅ 改池 | 无 |
| `templates.ts` | ❌ | ✅ `fromEventId`/`notBeforeMin`/`essential` | 无 |
| `types.ts` | ❌ | ✅ `fromEventId`（**将撤回**） | 无 |
| 新增文件 | `model/objective/places.ts` | `events.ts` / `WeekPlanView.tsx` / `events.test.ts` | 无 |

**唯一冲突的解法**（保留两侧改动，合并为一个函数）：

```ts
function studyCandidates(policy, dayCampus, templates): { preferred; fallback } {
  const all = policy.studyPlaces.map((p, i) => { /* …原逻辑… */ });

  // ← 保留 B 的改动：校区判断走显式地点表（campusOfPlace），不再关键字猜
  const sameCampus = (t: ActivityTemplate) =>
    (t.campus ?? 'any') === 'any' || campusOfPlace(t.place ?? '') === dayCampus;

  // ← 保留 CY 的改动：池内轮换 + 兜底分离
  const preferred = all.filter(sameCampus);
  const fallback = templates.filter(
    (t) => t.category === 'study' && sameCampus(t)
      && !preferred.some((w) => w.place === t.place),
  );
  return { preferred: preferred.length ? preferred : all, fallback };
}
```

> **裁决：校区判断取 `campusOfPlace` 而非 `t.campus`。** 两者在「模板未填 `campus` 字段」时会分叉——`campusOfPlace` 走显式地点表（T0.1 的成果，查不到返回 `null`），`t.campus` 依赖模板手填。**只保留一套判断，勿两套并存。**
>
> 配套：`fillStudy` 内 `rotateFrom(preferred, day + blocks.length)`；`fallback` 仅作兜底（偏好池全关门时）。

#### 12.5.5 代码约定（P1 起生效）

1. **纯度**：`construct` / `improve` / `objective` / `explain` 禁止 `fetch`、读时钟、`Math.random`（种子由入参注入）。
2. **block id 规则**：`w{weekNo}-d{day}-{kind}-{语义键}`，**不得含时间**（详见 §6.4）。
3. **构造等价**：`construct` 必须与**合并后**的 `schedule.ts` **逐块一致（块内容，不含 id）**；id 按 §6.4 新规则生成。golden baseline 以此为准，**只拍一次**。
4. **不猜**：认不出就返回 `null` + 出 `info`，不得回退关键字猜测或默认值（沿用 `campusOfName → null` 纪律）。
5. **可解释**：100% 软块有非空 `reason`。
6. **提交规范**：conventional commits（`feat(planner): …` / `fix(schedule): …` / `docs(scheduler): …`）。
7. **依赖纪律**：**撤掉 `tsx`**（CY 侧 `package.json` 的 `tsx: ^4.23.13` 与 +400 行 lock 变更），改用 §7.3 的零依赖钩子。

#### 12.5.6 待双方当面确认（不阻塞开工）

| # | 事项 | 现状 |
|---|---|---|
| 1 | **D-4 的「留用还是重做」** | `WeekPlanView.tsx` 已存在并接了 `App.tsx`（CY 侧）。需定：让它改消费 `PlanResult`（留用），还是重做。涉及 CY 的 UI 工作量保留与否 |
| 2 | 权重冻结 | 双方确认后冻结，再改须写 ADR |
| 3 | `_devtools/` 收进 `tests/` 的具体文件名 | 建议 `tests/register.mjs` + `tests/alias-hook.mjs` |
| 4 | PR review 时延 | 答辩节点紧（9/28 报名、10 月底决赛），建议 24h 内回 |

#### 12.5.7 沟通流程

1. 一切改动走 **`feat/*` → `dev`**，**禁止直接 push `main`**（AGENTS.md 红线 2）。
2. 跨人文件（`types.ts`）改动**先对齐再动手**，不先写代码后通知。
3. 每条事实性结论请**附核对命令与 ref**（如 `git show 8b29816:path | grep -n …`），避免口径漂移。
4. 出现新分歧，**追加到本文件**并在 PR 里引用，不另开新文档分散结论。

---

*本规格书是设计依据。P0 已完成并推送（`feat/planner-v2-p0` @ `22bdee88`，PR #2）。契约裁决与协作指令见 **§12.5**（已生效）。进入 P1 前，请确认 §12.5.6 的 4 项待办。*
