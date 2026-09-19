# -*- coding: utf-8 -*-
"""
远程验收循环（2026-09-18，CY 侧）——把「B 一推送就验收」变成一条命令
====================================================================
在此之前的流程是手工七步（fetch → 看 diff → merge-tree → commit-tree → archive →
建 junction → 跑 3 组测试 → push），已经手做了三遍。**第三次就该工具化了。**

本脚本做四件事，全程只读远程、只在需要时写本地对象（不动工作区）：

  ① 取远程最新：dev / beta 的 SHA；判定 dev 是否已有 beta 未包含的提交
  ② 干净合并：用 `git merge-tree --write-tree`（**看退出码判冲突**，不碰工作区）
     · 有冲突 → 打印冲突文件并停下（让人来看，不自动决策）
     · 干净   → 生成 merge commit 对象（**默认不推送**，`--push` 才推）
  ③ 干净检出：`git archive` 到 `_eng_check`（**必须是远程产物**，不是本地工作区 ——
     本地磁盘常年滞后，验它等于自欺）+ 借 node_modules 联接
  ④ 双口径验收：
     · B 自己的套件：test:engine（tests/）、test:ui（scripts/）
     · CY 侧独立口径：evals/engine/acceptance.ts（不变量 I1–I5，不依赖 B 的断言）

用法
----
  npm run verify:remote              # 只验收，不推送
  python scripts/verify_remote.py --push        # 验收通过才推 beta（有冲突/失败则不推）
  python scripts/verify_remote.py --runs 9      # 计数更稳的耗时对比
"""
import argparse
import json
import os
import re
import subprocess
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.join(os.path.dirname(ROOT), "usst-planner")   # 主仓库（worktree 的 git 元数据常被沙箱清掉）
# 干净检出**放在带 node_modules 的目录内部**：Node 的 ESM 解析会向上逐级找 node_modules，
# 于是**不需要建联接**。本环境禁止从脚本里调系统 shell 建 junction（实测被安全策略拦），
# 结果是检出没有依赖、报 "Cannot find package 'react'" —— 看着像产品失败，其实是环境失败。
CHECKOUT = os.path.join(ROOT, "_eng_check")
NODE_DIR = r"C:\Users\CY\.workbuddy\binaries\node\versions\24.14.0"
GIT_DIR = r"C:\Users\CY\.workbuddy\binaries\PortableGit\versions\1.2.0"


def env():
    e = os.environ.copy()
    e["PATH"] = os.pathsep.join([os.path.join(GIT_DIR, "cmd"), os.path.join(GIT_DIR, "usr", "bin"),
                                 NODE_DIR, e.get("PATH", "")])
    e["HTTPS_PROXY"] = e["HTTP_PROXY"] = "http://127.0.0.1:7890"   # gh/git 只认环境变量
    e["GIT_TERMINAL_PROMPT"] = "0"
    e["GIT_AUTHOR_NAME"] = e["GIT_COMMITTER_NAME"] = "CY"
    e["GIT_AUTHOR_EMAIL"] = e["GIT_COMMITTER_EMAIL"] = "cy@usst.local"
    e["NO_PROXY"] = e["no_proxy"] = "127.0.0.1,localhost"
    return e


def run(cmd, cwd=REPO, timeout=900):
    p = subprocess.run(cmd, cwd=cwd, env=env(), shell=True, capture_output=True,
                       text=True, encoding="utf-8", errors="replace", timeout=timeout)
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def sha(branch):
    rc, out = run(f"git ls-remote origin refs/heads/{branch}")
    if rc != 0 or not out.strip():
        return None
    return out.split()[0]


def ensure_local(sha_: str, branch: str) -> bool:
    """确保对象在本地（2026-09-19 实测：`ls-remote` 能拿到 SHA，但 `fetch` 可能**没把对象带回来**，
    于是 merge-tree 报 `not something we can merge`。这里显式补一次 fetch 并复核。）"""
    if not sha_:
        return False
    rc, _ = run(f"git cat-file -e {sha_}")
    if rc == 0:
        return True
    print(f"… 本地缺对象 {sha_[:8]}，显式 fetch {branch}")
    run(f"git fetch --no-tags origin {branch}:refs/remotes/origin/{branch}")
    rc, _ = run(f"git cat-file -e {sha_}")
    return rc == 0


def count_files(treeish: str) -> int:
    rc, out = run(f"git ls-tree -r --name-only {treeish}")
    return len([l for l in out.splitlines() if l.strip()]) if rc == 0 else -1


def main():
    ap = argparse.ArgumentParser(description="远程验收循环")
    ap.add_argument("--push", action="store_true", help="验收全绿才把 merge 推到 beta")
    ap.add_argument("--runs", type=int, default=5)
    args = ap.parse_args()

    rc, _ = run("git fetch origin '+refs/heads/*:refs/remotes/origin/*'")
    dev, beta = sha("dev"), sha("feat/integration-beta")
    print(f"🧭 远程：dev={dev[:8] if dev else '?'}  beta={beta[:8] if beta else '?'}")
    for s, br in ((dev, "dev"), (beta, "feat/integration-beta")):
        if not ensure_local(s, br):
            print(f"❌ 拉不到 {br}({s}) 的对象 —— 网络/代理问题？")
            return 1

    # dev 是否已包含在 beta 里
    rc, out = run(f"git merge-base --is-ancestor {dev} {beta}")
    if rc == 0:
        print("✅ beta 已包含 dev 最新提交（仍需跑验收以确认产物健康）")
        target = beta
    else:
        rc, out = run(f"git merge-tree --write-tree {beta} {dev}")
        if rc != 0:
            files = sorted({m.group(1) for m in re.finditer(r"^\d+ [0-9a-f]{40} [123]\t(.+)$",
                                                            out, re.M)})
            if not files:      # 兜底：另一种输出格式（CONFLICT (content): Merge conflict in X）
                files = sorted({m.group(1) for m in re.finditer(r"[Cc]onflict.*?\bin (.+?)\s*$",
                                                                out, re.M)})
            print(f"❌ dev 与 beta 合并失败（{len(files)} 个冲突文件）——需人工消解，**不自动决策**：")
            for f in files[:12]:
                print("   ·", f)
            if not files:      # 连文件都解析不出 → 把原始输出打出来，别只说"有冲突但没说是什么"
                print("   （无法解析冲突文件，原始输出如下）")
                for l in out.strip().splitlines()[:10]:
                    print("   |", l)
            return 1
        tree = out.split("\n")[0].strip()
        rc, out = run(f'git commit-tree {tree} -p {beta} -p {dev} '
                      f'-m "merge: dev({dev[:8]}) 并入 beta（verify_remote 自动合并）"')
        target = out.strip().splitlines()[-1].strip()
        print(f"🔀 干净合并 → {target[:8]}")

        # 🔴 文件数守卫（2026-09-19 事故后新增）：
        # 我曾在构建提交时手抄了过期的基树 SHA，导致一次推送"删掉"22 个文件
        # （evals/ 全部、scripts/verify_remote.py…），而**只有下游验收报模块缺失时才暴露**。
        # 合并/提交**只会增删文件，不该整批消失** —— 少一个就先停下问人。
        n_before, n_after = count_files(beta), count_files(target)
        if n_after < n_before:
            print(f"❌ 文件数守卫：{n_before} → {n_after}（减少了 {n_before - n_after} 个）——拒绝继续。")
            print("   常见原因：构建提交时用错了基树/SHA。请核对 `git diff --stat <旧> <新>` 里的删除项。")
            return 1
        print(f"  文件数守卫：{n_before} → {n_after} ✅")

    # 干净检出（必须是远程产物）
    run(f'rm -rf "{CHECKOUT}" && mkdir -p "{CHECKOUT}"')
    rc, out = run(f'git archive {target} | tar -x -C "{CHECKOUT}"')
    if rc != 0:
        print("❌ 检出失败：", out[-300:])
        return 1
    env_bak = os.environ.get("PATH", "")
    os.environ["PATH"] = env_bak  # 由 run() 统一注入 PATH
    # 不进仓库的「补给」必须显式带过去（实测教训：漏了 public/my_schedule.json 会让
    # 一个测试档加载失败 → 测试数从 145 掉到 137、并报 1 个失败，看着像产品问题其实是环境问题）
    for extra in ("server/.env", "public/my_schedule.json"):
        src, dst = os.path.join(REPO, extra), os.path.join(CHECKOUT, extra)
        if os.path.exists(src):
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            open(dst, "wb").write(open(src, "rb").read())
    # 依赖解析说明：检出目录的外层（仓库工作区）就有 node_modules，Node 会向上找到它，
    # 因此这里不需要任何联接/拷贝。若把本脚本搬走，请保证祖先目录里有 node_modules。
    if not os.path.isdir(os.path.join(ROOT, "node_modules")):
        print("⚠️ 外层目录缺 node_modules —— 前端/引擎套件会报模块找不到")
    print(f"📦 干净检出：{CHECKOUT}")

    fails = []
    for label, cmd in (("B 引擎套件(tests/)", "npm run test:engine"),
                       ("B 前端套件(scripts/)", "npm run test:ui")):
        rc, out = run(cmd, cwd=CHECKOUT)
        m = dict(re.findall(r"^[ℹ#] (tests|pass|fail) (\d+)", out, re.M))
        line = f"tests={m.get('tests','?')} pass={m.get('pass','?')} fail={m.get('fail','?')}"
        ok = rc == 0
        print(f"  {'✅' if ok else '❌'} {label}：{line}")
        if not ok:
            fails.append(label)
            bad = [l.strip() for l in out.splitlines()
                   if l.strip().startswith("✖") or "Error:" in l][:5]
            for b in bad:
                print("       ↳", b[:150])

    rc, out = run(f"node --import ./scripts/register-alias.mjs evals/engine/acceptance.ts "
                  f"--runs {max(2, args.runs)} --json evals/runs/verify_{target[:8]}.json",
                  cwd=CHECKOUT)
    verdict = [l for l in out.splitlines() if l.startswith("结论") or "不变量" in l][-3:]
    print("  " + ("✅" if rc == 0 else "❌") + " CY 侧独立验收：")
    for l in verdict:
        print("     ", l.strip())
    if rc != 0:
        fails.append("CY 侧独立验收（不变量）")

    if fails:
        print(f"\n🚫 验收未通过：{fails} → **不推送**")
        return 1
    print("\n✅ 验收全绿")
    if args.push:
        rc, out = run(f"git push origin {target}:refs/heads/feat/integration-beta", timeout=240)
        if rc != 0:
            print("❌ 推送失败：", out[-300:])
            return 1
        print(f"📤 已推送 beta = {target[:8]}")
    else:
        print(f"（未推送；确认无误后：git push origin {target}:refs/heads/feat/integration-beta）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
