/**
 * 删除确认弹窗（2026-09-19）
 * ============================================================
 * 用户删掉一块后问一句：**这个空档怎么办？**
 *
 * 四个出口（用户拍板的流程）：
 *   · **⬆ 后面的日程补上来** —— 只动软事（自习/活动/手动块），
 *     课程与三餐纹丝不动（生理锚点与既成事实，见 `ripple.fillGap`）；
 *   · **⬜ 留出空白** —— 空档就空着；
 *   · **🔄 整周重新排** —— 触发现有「重新排一遍」；
 *   · **取消删除** —— 块回到计划里（撤销，走 `excluded` 通道移除）。
 *
 * 纯 UI：不碰存储，动作全部通过回调交给父组件。
 */
export function DeleteAskDialog({
  title, timeText, onFill, onKeepGap, onReplan, onCancel,
}: {
  title: string;
  /** 被删块的人话时间（如「周三 14:00–15:00」），由父组件拼好 */
  timeText: string;
  onFill: () => void;
  onKeepGap: () => void;
  onReplan: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-lg">
        <h3 className="text-[14px] font-semibold text-ink">已删除「{title}」</h3>
        <p className="mt-1 text-[11.5px] leading-relaxed text-ink-soft">
          {timeText}空出来了 —— 这个空档怎么处理？
        </p>
        <div className="mt-3 grid gap-2">
          <button
            type="button"
            onClick={onFill}
            className="flex min-h-11 items-center gap-3 rounded-xl border border-ink/10 bg-paper px-3 py-2 text-left text-[13px] font-medium text-ink transition-colors hover:border-brand/40 hover:bg-brand-light/45"
          >
            <span className="text-base">⬆</span>
            <span>
              后面的日程补上来
              <span className="block text-[11px] font-normal text-ink-faint">
                只挪自习和活动；吃饭和上课的时间不动
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={onKeepGap}
            className="flex min-h-11 items-center gap-3 rounded-xl border border-ink/10 bg-paper px-3 py-2 text-left text-[13px] font-medium text-ink transition-colors hover:border-brand/40 hover:bg-brand-light/45"
          >
            <span className="text-base">⬜</span>
            <span>
              留出空白
              <span className="block text-[11px] font-normal text-ink-faint">
                那段时间就空着，别的安排不动
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={onReplan}
            className="flex min-h-11 items-center gap-3 rounded-xl border border-ink/10 bg-paper px-3 py-2 text-left text-[13px] font-medium text-ink transition-colors hover:border-brand/40 hover:bg-brand-light/45"
          >
            <span className="text-base">🔄</span>
            <span>
              整周重新排
              <span className="block text-[11px] font-normal text-ink-faint">
                让引擎看全局重新安排一遍
              </span>
            </span>
          </button>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-2.5 py-1 text-[11.5px] text-ink-faint hover:text-ink"
          >
            取消删除（恢复这块）
          </button>
        </div>
      </div>
    </div>
  );
}
