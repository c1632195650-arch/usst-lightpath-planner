/**
 * 光溯移动端 · 本地通知桥（F13/F14/F15 · 方案 §8.2）
 * ============================================================
 * **能力分支集中此一处**（方案 §7.1）：
 *   · Web 环境 → 全部 no-op（浏览器不发本地通知，页内横幅已是提醒主通道）；
 *   · Capacitor（APK）→ 动态 import 插件，全量覆盖式重排当日剩余通知。
 *
 * 调度姿势（借鉴 Super Productivity，规避 Android 12+ SCHEDULE_EXACT_ALARM 深坑）：
 *   · **不申请精确闹钟**：非精确调度（inScheduleTime 粒度分钟级可接受，软提醒定位）；
 *   · 每个剩余块两条：开始前 10 分钟（「即将开始」）+ 开始时刻（「现在开始 · 至 HH:MM」）；
 *   · 通知 id = stableHash(blockId + date) % 1e8 —— 确定性，覆盖替换幂等；
 *   · 触发时机：每次同步成功 / App 进前台 / 手动刷新 → 全量重排（先 cancel 全部再排）；
 *   · 动作按钮 [完成✓, 顺延15] → on('actionPerformed') 直接写覆盖层 → 下次 sync 上报。
 *
 * 已知风险（诚实登记，方案 §8.2 同款）：手机重启后排程丢失（AlarmManager 不持久）。
 * 缓解：每次打开 App 全量重排；引导页写明「重启后打开一次 App 即恢复」。
 * v1 不做的 stretch：每分钟跳动的倒计时（需前台服务）、BootReceiver 开机重排。
 */
import type { TimeBlock } from '@/types';
import { stableHash, fmtMin } from './sync.ts';

/** 是否跑在 Capacitor 壳里（web 构建里恒 false，插件代码路径完全不激活） */
export async function isNative(): Promise<boolean> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

interface NotifBridgeResult {
  scheduled: number;
  ok: boolean;
}

function notifId(blockId: string, dateKey: string, offset: number): number {
  return stableHash(`${blockId}@${dateKey}#${offset}`) % 100_000_000;
}

/** 一条待排通知的纯描述（与 Capacitor 插件解耦，可在 Node 单测） */
export interface NotifSpec {
  id: number;
  /** 触发时刻：当日分钟偏移（调用方换算成 Date） */
  atMin: number;
  title: string;
  body: string;
  actionTypeId: 'block-actions';
  extra: { blockId: string; action: 'before' | 'start' };
}

/**
 * 「今天剩余块 → 通知清单」的**纯调度决策**（方案 §8.2）：
 *   · 每个未结束块两条：开始前 10 分钟（nowMin 之后才排）+ 开始时刻；
 *   · 已开始的块只排「现在开始」一条（下一分钟触发）；
 *   · id 确定性 = stableHash(blockId@dateKey#offset) —— 覆盖式重排靠它幂等替换。
 * done 过滤由调用方完成（传入的 blocks 应已是「剩余块」）。
 */
export function planTodayNotifications(
  blocks: readonly TimeBlock[],
  nowMin: number,
  dateKey: string,
): NotifSpec[] {
  const out: NotifSpec[] = [];
  for (const b of blocks) {
    if (b.endMin <= nowMin) continue; // 已结束：不排
    const title = `${b.emoji ?? ''}${b.title}`;
    const body = b.place ? `${title} · ${b.place}` : title;
    if (b.startMin - 10 > nowMin) {
      out.push({
        id: notifId(b.id, dateKey, 0),
        atMin: b.startMin - 10,
        title: `即将开始：${fmtMin(b.startMin)} ${title}`,
        body,
        actionTypeId: 'block-actions',
        extra: { blockId: b.id, action: 'before' },
      });
    }
    if (b.startMin > nowMin || nowMin < b.endMin) {
      out.push({
        id: notifId(b.id, dateKey, 1),
        atMin: Math.max(b.startMin, nowMin + 1),
        title: `现在开始：${title} · 至 ${fmtMin(b.endMin)}`,
        body,
        actionTypeId: 'block-actions',
        extra: { blockId: b.id, action: 'start' },
      });
    }
  }
  return out;
}

/**
 * 全量重排「今天剩余块」的通知（覆盖式，幂等）。
 * blocks 应为**已套覆盖层**的当日块列表；nowMin 之前的块不再排。
 */
export async function rescheduleToday(blocks: readonly TimeBlock[], nowMin: number): Promise<NotifBridgeResult> {
  if (!(await isNative())) return { ok: true, scheduled: 0 }; // Web：页内横幅足够（方案 F1 决策）
  try {
    const [{ LocalNotifications }, { Capacitor }] = await Promise.all([
      import('@capacitor/local-notifications'),
      import('@capacitor/core'),
    ]);

    // 通知权限：APK 首次进来要一次（拒绝就静默 —— 页内横幅仍可用，不再骚扰）
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') {
      const req = await LocalNotifications.requestPermissions();
      if (req.display !== 'granted') return { ok: false, scheduled: 0 };
    }

    // 动作按钮（F14）：完成 / 顺延 15 分
    await LocalNotifications.registerActionTypes({
      types: [
        {
          id: 'block-actions',
          actions: [
            { id: 'done', title: '✓ 完成' },
            { id: 'snooze15', title: '顺延 15 分' },
          ],
        },
      ],
    });

    const now = new Date();
    const dateKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    const upcoming = blocks.filter((b) => b.endMin > nowMin);
    const pending: Parameters<typeof LocalNotifications.schedule>[0]['notifications'] = [];
    for (const spec of planTodayNotifications(upcoming, nowMin, dateKey)) {
      const at = new Date(now);
      at.setHours(0, 0, 0, 0);
      at.setMinutes(spec.atMin);
      pending.push({
        id: spec.id,
        title: spec.title,
        body: spec.body,
        schedule: { at, allowWhileIdle: true },
        actionTypeId: spec.actionTypeId,
        extra: spec.extra,
      });
    }

    // 覆盖式：先清今天的全部再排（cancel 旧 id；未知的旧 id 由 getPending 过滤）
    const old = await LocalNotifications.getPending();
    await LocalNotifications.cancel({ notifications: old.notifications });
    if (pending.length > 0) await LocalNotifications.schedule({ notifications: pending });
    return { ok: true, scheduled: pending.length };
  } catch (e) {
    console.warn('[mobile-notify] 重排失败（页内横幅不受影响）：', e);
    return { ok: false, scheduled: 0 };
  }
}

/**
 * F15 常驻「正在进行」通知：块开始时发布（id 固定），块结束撤销。
 * v1 静态文本（无每分钟倒计时 —— 那要前台服务，stretch）。
 */
export async function showOngoing(block: TimeBlock | null): Promise<void> {
  if (!(await isNative()) || !block) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const now = new Date();
    const dateKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    const id = notifId(`${block.id}#ongoing`, dateKey, 2);
    await LocalNotifications.schedule({
      notifications: [{
        id,
        title: `正在进行：${block.title} · 至 ${fmtMin(block.endMin)}`,
        body: block.place ? `地点：${block.place}` : '',
        schedule: { at: new Date(), allowWhileIdle: true },
        ongoing: true,
        extra: { blockId: block.id, action: 'ongoing' },
      }],
    });
  } catch (e) {
    console.warn('[mobile-notify] 常驻通知失败：', e);
  }
}

/**
 * 通知动作按钮 → 覆盖层效果（F14）。返回动作语义，由调用方写 userPlanStore：
 *   · done → 该块标完成；snooze15 → startMin/endMin +15（顺延 15 分）。
 */
export function registerActionHandler(
  handler: (blockId: string, action: 'done' | 'snooze15') => void,
): void {
  if (typeof window === 'undefined') return;
  // Capacitor 插件的事件挂在 window.Capacitor 上；web 环境无此对象，静默跳过。
  void (async () => {
    try {
      if (!(await isNative())) return;
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      await LocalNotifications.addListener('localNotificationActionPerformed', (n) => {
        const blockId = (n.notification.extra as { blockId?: string } | undefined)?.blockId;
        const act = n.actionId as 'done' | 'snooze15' | string;
        if (blockId && (act === 'done' || act === 'snooze15')) handler(blockId, act);
      });
    } catch {
      /* 桥不可用：通知动作失效但不影响页内操作 */
    }
  })();
}
