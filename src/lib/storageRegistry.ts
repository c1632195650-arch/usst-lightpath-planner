/**
 * localStorage key 登记表（前端架构规格书 §11 AC-11）
 * ============================================================
 * 项目里所有持久化 key 都是 `usst-*` 字符串常量，散落在各自的 store 里。
 * 问题：新加一个 key 时没人知道「这是第几个、谁拥有、有没有和别的 key 撞车」，
 * 也没人知道某个 key 是否已废弃。
 *
 * 本表是**唯一清单**：任何 `src/**` 里出现的 `'usst-…'` 字符串字面量，都必须
 * 在这里登记（由 `tests/storageRegistry.test.ts` 强制，双向校验）——
 *   · 正向：代码里出现的 key 必须在表里（漏登记 → 红灯）；
 *   · 反向：表里的 key 必须真的被代码用过（僵尸登记 → 红灯）。
 *
 * 纪律：
 *   · 本文件是**纯常量模块**，零依赖、零副作用（`lib/**` 不许 import react /
 *     features / 读 `import.meta.env`，见 §4.1 规则 1 / 4）；
 *   · 新增 key 时**只改这一处** + 对应 store，别再新建第二份清单；
 *   · 规范正文（给产品/交互看的版本）在工作区根《页面与使用逻辑规格书》§4.3，
 *     改这里要同步改那里。
 */

/** 登记表建立时间（本表自身用来判断"比它新的 key 是否漏登记"的口径起点） */
export const REGISTRY_SINCE = '2026-09-21';

export interface StorageKeyMeta {
  /** 谁拥有该 key 的读写语义（对齐仓库 AGENTS.md §二 文件所有权） */
  owner: 'CY' | 'B';
  /** 唯一读写入口模块（相对 `src/` 的路径，去扩展名） */
  module: string;
  /** 规格书出处（有则填，格式「规格书文件名 §节号」） */
  spec?: string;
  /** 除主入口外还会读它的模块（迁移/兼容场景；只读，不写） */
  alsoReadBy?: string[];
  /**
   * 已废弃：新写入不得再用，只在迁移时读一次。
   * 判据 = 该 key 的 load / save 函数已无调用方（只剩纯函数被别的模块消费）。
   * 清掉迁移逻辑后，本行连同 store 一起删。
   */
  legacy?: true;
  /**
   * 本机专属：只写 localStorage、**绝不入库**（`cloudKeys()` 会把它剔除）。
   * 用于「这台机器的缓存属于谁」这类纯本机状态 —— 一旦上云，换设备就会串号。
   */
  localOnly?: true;
}

/**
 * 全量 key 登记表。**只增不改名**：key 字符串一旦发布就不能变（老用户的
 * localStorage 里躺的是旧串），要换代就加 `-v2` 并把旧 key 标出来。
 */
export const STORAGE_KEYS = {
  /** AppState（画像答案 / 课表 / onboarding 标记）—— 主存储，非覆盖层 */
  'usst-life-assistant-v2': {
    owner: 'CY',
    module: 'lib/storage',
    spec: '页面与使用逻辑规格书 §4.3',
  },

  /** UserPlanLayer 覆盖层（任务 / 排除 / 移动 / 不可时段 / 调课 / 食堂 / 住处 / 指派） */
  'usst-user-plan-v1': {
    owner: 'B',
    module: 'features/week/userPlanStore',
    spec: '页面与使用逻辑规格书 §4.3',
  },

  /** 作息边界（Q1a：wakeMin / sleepMin / weekdayDiffMin / napMin） */
  'usst-routine-v1': {
    owner: 'B',
    module: 'features/week/routineStore',
    spec: '问卷规格书-面向排程引擎 §6.2',
  },

  /** 目标偏好（freeDays / focusMinutes / timeOfDay / parallelCount） */
  'usst-goal-prefs-v1': {
    owner: 'B',
    module: 'features/activity/goalPrefs',
    spec: '问卷规格书-面向排程引擎（目标偏好附加组）',
  },

  /** 统一日期层：用户自定义 + 忽略的内置项（目标截止由 goals 现算，不入库） */
  'usst-important-dates-v1': {
    owner: 'B',
    module: 'features/overview/importantDatesStore',
    spec: '总览页改版计划书-2026-09-20 §四 批次 1',
  },

  /** 「兴趣追问」跳过标记（跳过即永不再弹，弹窗纪律 D6） */
  'usst-interest-ask-dismissed-v1': {
    owner: 'B',
    module: 'features/activity/InterestAskDialog',
    spec: '总览页改版计划书-2026-09-20 §二 D6',
  },

  /** 目标清单（Goal[]，含 source: 'auto' | 'manual'） */
  'usst-goals-v1': {
    owner: 'B',
    module: 'features/activity/goalStore',
  },

  /** 活动补记流水 */
  'usst-activity-log-v1': {
    owner: 'B',
    module: 'features/activity/activityStore',
  },

  /** 行为日志（只读历史口径，与活动补记并列） */
  'usst-behavior-log-v1': {
    owner: 'B',
    module: 'features/behavior/behaviorLog',
  },

  /** 偏好校正清单（CorrectionRule[]） */
  'usst-pref-corrections-v1': {
    owner: 'B',
    module: 'features/feedback/store',
  },

  /** 任务指派（blockId → 谁做）—— 存储已并入覆盖层，本 key 只作迁移读取 */
  'usst-assignments-v1': {
    owner: 'B',
    module: 'features/week/assignmentStore',
    alsoReadBy: ['features/week/userPlanStore'],
    legacy: true,
  },

  /** 卡片级编辑（推后 / 缩短 / 加时等）—— 存储已并入覆盖层，本 key 只作迁移读取 */
  'usst-plan-edits-v1': {
    owner: 'B',
    module: 'features/week/planEditsStore',
    alsoReadBy: ['features/week/userPlanStore'],
    legacy: true,
  },

  /* ── 点号风格三连（2026-09-27 补登记：守卫此前只扫 `usst-` 连字符风格，这三条漏网）── */

  /** 遥测流水（环形 500 条，无后端端点；入库经 persistence 双写） */
  'usst.telemetry.v1': {
    owner: 'B',
    module: 'lib/telemetry',
  },

  /** 梨宝用户标识（后端会话档案定位）—— WP1 起取值收敛到 `lib/identity` 的 getUserId() 单点 */
  'usst.libao.user_id': {
    owner: 'CY',
    module: 'lib/identity',
    alsoReadBy: ['features/libao/LbaoChat'],
  },

  /** 梨宝会话标识 */
  'usst.libao.session_id': {
    owner: 'CY',
    module: 'features/libao/LbaoChat',
  },

  /** 基础信息（称呼/年级/学院/专业/校区/宿舍）—— WP1 基础信息前置，唯一读写入口 lib/identity */
  'usst.libao.basic_info': {
    owner: 'CY',
    module: 'lib/identity',
    alsoReadBy: ['features/welcome/BasicInfoStep', 'features/persona/PersonaResult'],
  },

  /* ── 本机专属（localOnly：进登记表只为让守卫看得见，绝不入库）── */

  /* ── 三线融合（2026-10-01）补登记：beta-v2 侧梨宝链路的三个 key ── */

  /** 用户自定义重要日（checklist「加个重要日」/ PrepPlan 排程的真源之一） */
  'usst.libao.deadlines.v1': {
    owner: 'CY',
    module: 'features/calendar/deadlineStore',
  },

  /** 梨宝对话本地快照（E8 跨会话恢复：与后端 chatHistory 合并去重） */
  'usst.libao.chat.v1': {
    owner: 'CY',
    module: 'features/libao/LbaoChat',
  },

  /** 梨宝对话本地快照 v2（S/T/D 批 topic 容器版；dialogManager SNAPSHOT_V2_KEY） */
  'usst.libao.chat.v2': {
    owner: 'CY',
    module: 'features/libao/dialogManager',
  },

  /** 梨宝对话本地快照 v3（D3 起：topic 单容器 + missStreak；dialogManager SNAPSHOT_V3_KEY） */
  'usst.libao.chat.v3': {
    owner: 'CY',
    module: 'features/libao/dialogManager',
  },

  /** 梨宝「清空对话」本页标记（清空后本标签页不再自动恢复历史） */
  'usst.libao.chat.cleared': {
    owner: 'CY',
    module: 'features/libao/LbaoChat',
  },

  /**
   * 本机缓存归属账号（持久化与账号系统实施规格书 §5.5，2026-10-01 补）。
   * 记录「当前 localStorage 缓存属于哪个账号」——换账号时以此判定是否清缓存重建。
   * 标 `localOnly`：它是**这台机器**的事实，上云会变成可同步状态，反而制造串号。
   */
  'usst.local_owner.v1': {
    owner: 'B',
    module: 'lib/persistence',
    spec: '持久化与账号系统实施规格书 §5.5',
    localOnly: true,
  },
} as const satisfies Record<string, StorageKeyMeta>;

/** 所有已登记的 key 字符串 */
export type StorageKey = keyof typeof STORAGE_KEYS;

/** 便于测试与调试遍历（顺序 = 声明顺序） */
export const STORAGE_KEY_LIST: readonly StorageKey[] =
  Object.keys(STORAGE_KEYS) as readonly StorageKey[];

/** 某个 key 是否已登记 */
export function isRegisteredKey(key: string): key is StorageKey {
  return Object.prototype.hasOwnProperty.call(STORAGE_KEYS, key);
}

/** key 的登记元数据；未登记返回 null */
export function metaOf(key: string): StorageKeyMeta | null {
  return isRegisteredKey(key) ? STORAGE_KEYS[key] : null;
}
