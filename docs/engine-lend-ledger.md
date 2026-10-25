# 引擎借出登记表（campuskit ← _work_dev）

| 日期 | 借出物 | 源 commit（_work_dev） | campuskit commit | 验收证据 |
|---|---|---|---|---|
| 2026-10-25 | M1+M2a：引擎 35 源文件 + types/constants/date/kb-params + tools 四闸门 | `ae6a3d5`（tag `engine-snapshot-20261024`） | `8a9fc7b` + `6664148` | E1 依赖清点（仓内 5 项/外部 npm 0）；import 语句零 `@/` 残留 |
| 2026-10-25 | M2b：31 纯引擎测试 + golden 六份 + CI + playground | 同上 | `a430694` | **golden 六份逐字节一致（fc /b IDENTICAL ×6，2026-10-25 K1 实测）**；267/267 断言全绿（本地 + CI 首绿 `success`） |

## 已知偏离（C3 白名单预备）

- `CampusId` 仍为上理校区枚举（campuskit 副本原样照抄）——K2/M2c Profile 化时放宽，届时在此登记
- `transfer.ts` 未随批（app 适配层，引擎内零引用）；`planWeek.defaultFetchRoutes` 改恒 null（问路注入式）
- `events.ts` 的 `Deadline`/`PrepPlan` 类型在 campuskit 内本地声明（数据不跨界、类型可走）
