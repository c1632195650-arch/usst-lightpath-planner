import type { ChatResult } from '@/lib/api';

/**
 * 一轮对话的**调试抽屉** —— 只在 DEV（`npm run dev`）渲染，生产构建里整段被摇掉。
 *
 * 为什么需要它
 * ------------
 * 后端 `/api/chat` 其实**一直在返回** `route / intent / top_raw_vec / used_space /
 * used_memory / used_profile`，`sources` 里也一直带着 `score` 与 `raw_vec`。
 * 但前端只取了 `answer / sources / mode`，其余当场丢掉 —— 于是「梨宝答得不对」时，
 * 页面上没有任何第二手信息，只能去翻后端日志或加断点。
 *
 * 它把「一轮到底哪坏了」拆成四段，一眼能看出卡在哪一层：
 *
 *  | 现象                                   | 结论     |
 *  |----------------------------------------|----------|
 *  | `raw_vec` 低（< 0.56）且来源全是无关标题 | 检索错   |
 *  | 标题对，但 `snip` 很短 / 里面没有答案    | 上下文错 |
 *  | 上下文里有答案，回答却跑偏               | 模型错   |
 *  | 这里一切正常，页面显示不对               | 渲染错   |
 *
 * 与后端 `LIBAO_DEBUG=1` 的 trace 行靠 `request_id` 对齐（同一格式的 8 位十六进制）。
 */
export function ChatDebug({ data }: { data: ChatResult }) {
  const route = data.route ?? '-';
  const topRaw = data.top_raw_vec;
  // 阈值与后端 RAW_HIGH / RAW_LOW 一致（见 server/app.py 的校准注释）
  const rawTag =
    topRaw === undefined ? ''
      : topRaw >= 0.68 ? '知识库有'
        : topRaw >= 0.56 ? '相关但可能不全'
          : '知识库外';
  const flag = (on?: boolean) => (on ? '✓' : '·');
  const sources = data.sources ?? [];
  // 健康库等级：阻断三档（urgent/diagnosis/myth）要一眼可见 —— 这三档的回答里
  // 含「只能原样传达」的安全口径，不该和普通命中混在一起看。
  const healthLevel = data.health_level;
  const healthBlocked = healthLevel === 'urgent' || healthLevel === 'diagnosis' || healthLevel === 'myth';
  const healthTag = data.used_health ? (healthLevel && healthLevel !== 'ok' ? healthLevel : '✓') : '·';

  return (
    <details className="w-full pl-1">
      <summary className="cursor-pointer select-none text-[11px] leading-5 text-ink-faint">
        调试 · {route} · {data.intent ?? '-'} · raw_vec={topRaw?.toFixed(3) ?? '-'}
        {' '}· 空间{flag(data.used_space)} 记忆{flag(data.used_memory)} 档案{flag(data.used_profile)}
        {' '}方法{flag(data.used_study)} 健康{healthTag}
        {data.elapsed_ms !== undefined ? ` · ${data.elapsed_ms}ms` : ''}
        {data.request_id ? ` · ${data.request_id}` : ''}
      </summary>

      <div className="mt-2 space-y-2 rounded-lg border border-ink/10 bg-paper px-3 py-2 text-[11px] leading-5 text-ink-soft">
        <div>
          <span className="font-semibold text-ink">路由判定</span>：{route}
          {topRaw !== undefined && <>（raw_vec {topRaw.toFixed(3)} → <span className="font-semibold">{rawTag}</span>）</>}
          ｜阈值 0.68 / 0.56
        </div>
        <div>
          <span className="font-semibold text-ink">意图</span>：{data.intent ?? '-'}
          ｜<span className="font-semibold text-ink">模式</span>：{data.mode}
          ｜<span className="font-semibold text-ink">回答长度</span>：{data.answer.length}
        </div>

        {(data.used_study || data.used_health || data.study_pseudo) && (
          <div className="space-y-1">
            <div className="font-semibold text-ink">专项库命中</div>
            {data.used_study && (
              <div>
                方法库：{(data.study_sources ?? []).filter(Boolean).join('｜') || '-'}
                <span className="text-ink-faint">
                  （top_raw {data.study_top_raw?.toFixed(3) ?? '-'}，与上理库门限不同：0.60 / 0.50）
                </span>
              </div>
            )}
            {data.study_pseudo && (
              <div>命中伪科学纠正口径 —— 回答里的纠正文案是确定性拼进去的，不走检索（故无来源）。</div>
            )}
            {data.used_health && (
              <div className={healthBlocked ? 'text-ink' : undefined}>
                健康库[{healthLevel ?? '-'}]：
                {(data.health_sources ?? []).filter(Boolean).join('｜') || '（阻断级不给检索条目）'}
                <span className="text-ink-faint">（top_raw {data.health_top_raw?.toFixed(3) ?? '-'}）</span>
                {healthBlocked && <> ← 阻断级：安全口径只能原样传达</>}
              </div>
            )}
          </div>
        )}

        <div>
          <div className="font-semibold text-ink">
            检索来源（{sources.length} 条）—— score 是归一化排序分（不可判相关性），raw_vec 才是
          </div>
          <ol className="mt-1 space-y-1.5">
            {sources.map((s, i) => (
              <li key={i} className="border-t border-ink/10 pt-1.5 first:border-0 first:pt-0">
                <div className="text-ink">
                  [{i + 1}] {s.title}
                </div>
                <div className="text-ink-faint">
                  score={s.score?.toFixed(3) ?? '-'}｜raw_vec={s.raw_vec?.toFixed(3) ?? '-'}
                  ｜snip={s.snippet ? s.snippet.length : 0} 字
                  {s.snippet ? '' : ' ← 空的，等于没喂给模型'}
                </div>
                {s.snippet && (
                  <div className="mt-0.5 line-clamp-3 text-ink-faint">{s.snippet}</div>
                )}
              </li>
            ))}
          </ol>
        </div>

        <div className="text-ink-faint">
          snip 短或为空 → 上下文错；raw_vec 低 + 标题不相关 → 检索错；
          这里都对但回答跑偏 → 模型错。后端开 <code>LIBAO_DEBUG=1</code> 可拿到同 request_id 的一行 trace。
        </div>
      </div>
    </details>
  );
}
