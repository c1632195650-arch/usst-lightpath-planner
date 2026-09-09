# Newton 开发日志 · 棱镜投影排程（v1 → v9）

> 记录每一轮改了什么、为什么改、踩过哪些坑。**后续修改前必读**，避免重复踩坑。

---

## v1 · 视觉原型（Canvas 2D 平面色散）
- 白光 → 棱镜 → 色散成扇面；5 套配色可切换。
- 关键：**第 5 套"浅色玻璃"是对照组**——验证出「米白/浅底上光效会发闷，像彩色纸条不像光」。
- 结论：光谱区必须用**深色容器**（棱镜暗箱 / 望远镜目镜）才像光。

## v2 · 暗室 3D（Three.js）
- 从 2D 平面改真 3D 暗室：吊灯 + 体积光锥 + 可拖拽三棱柱 + 6 条色散光 + 尘埃。
- 学习点：**"致敬牛顿棱镜"不需要物理引擎**——出射角度是"设计"出来的，不是算折射率。

## v3 · 拟物（对标真实暗房照片）
- 放弃"黑舞台"，改"真实房间"：5 面墙 + 地面 + 真实灯具（灯罩/灯泡/收口/挂线）+ 柔光 halo + 更厚棱镜。
- 光束末端加 **2D 高斯圆头**（光打到墙上的接触亮斑）。

## v4 · 抄 HTML-Light-Demo 光源
- 直接参考 <https://github.com/jinruozai/HTML-Light-Demo> 的光源 rig：
  - `LatheGeometry` 灯罩曲线 + `emissive` 灯泡（emissiveIntensity 3.2）
  - `radial-gradient` glow Sprite（白→暖黄→橙，Additive）——**光感核心**
  - `SpotLight(power 1450, penumbra 0.88)` ← 光斑边缘极柔的关键
  - `NeutralToneMapping`（非 ACES，去塑料感）
- 注意：glow sprite 的 opacity **不要每帧 `*=`**，会累乘漂移，应直接赋值。

## v5 · 投影幕版（构图转向）
- 核心转向：**幕布是焦点**（排程投影屏），棱镜移到右下成为"仪式感旋钮"，切换排程 = 棱镜转一圈 + 幕布光流扫入。
- 幕布内容用 `emissiveMap`（CanvasTexture）自发光贴出排程色带（宽 = 体验密度）。
- 加 `UnrealBloomPass` 让色带/光束发光。

## v6 · 投影幕排程定版
- 幕布正对用户、拉近；光束细而淡；落点随棱镜转动在幕布内限幅摆动。
- **严重 bug（耗时 4 轮）**：幕布一直过曝成纯白屏。
  - 根因：**`MeshStandardMaterial` 的 `color=0xffffff` 会被 envMap + hemisphere 加亮到接近 1**，与 emissive 无关。
  - 修复：`color: 0x000000`（黑基色），颜色完全由 `emissiveMap` 决定。
  - 次坑：canvas 透明背景会被环境光填亮 → `drawSchedule` 先 `fillRect('#0a0c12')` 给深色底。
  - 次坑：写了黑底后紧跟 `clearRect` 把黑底擦掉（自身 bug）。
  - 次坑：Edit 时 `old_string` 不够长，末尾 `}));` 重复 → SyntaxError。
- **调试技巧**：把 `sCanvas` 临时挂 `window.__sCanvas`，导出 PNG 看 canvas 本身内容，先区分"数据问题还是渲染问题"。

## v7 · 光路叙事（入射 + 棱镜内光路）
- 删除整个头顶灯 rig；入射光改为**从屏幕右下角光口射入**；棱镜内部加**贯穿白光线**（`depthTest:false` 保证透玻璃可见）。
- 光束加粗到 0.22，6 条色散打满幕墙。
- **踩坑**：shader 模板字符串 `${widthK}` 插出整数 `1` → GLSL `float/int` 除法编译错。
  - 修复：所有数值用 `${(+x).toFixed(3)}` 强制浮点字面量。

## v8 · 模块级光影投射
- **每个模块一条光**：颜色直接取 `SCHEDULE[ver].blocks[i].c`，落点 = 模块中心；切版时光束颜色/数量/位置全部跟随新排程。
- `drawSchedule` 改为**返回布局** `[{cxPx, wPx, color}]`，供光束重建使用。
- 模块顶部加**投影光斑 Sprite**（模块色 + 暖白渐变），"光打顶"感。
- canvas 投影质感：暗幕底色 `#171b26` + 色带上下渐变 + 顶部受光高光条 + 底部阴影。
- **踩坑**：光束过宽（`wWorld*0.5`）盖死模块 → 收窄到 `wWorld*0.14`（细针状）+ 光斑独立。
- **踩坑**：`const $` 定义在 `nextSchedule` 之后，但 `buildBeams` 首次调用要用 → TDZ 崩溃。把 `$` 提前到 `SCHEDULE` 之后。

## v9 · 高精度光学演示（当前版本，收敛去动态）
按 9 条硬性要求收敛：

1. **棱镜本体清晰**：位置从 (2.55,…) 拉回 **(0.95, 1.55, 1.8)**（之前已出屏外！）；`transmission 0.72 + clearcoat 0.7 + envMapIntensity 0.75`；EdgesGeometry 亮边 opacity 0.85；删除底部光环 `prismHalo`。
2. **光束不遮挡课表**：3 条宽淡光（halo 1.4）终点全在地面 `y ≤ 0.20`（幕布底 0.47 之下），路径 z ∈ [-2, -0.4]，永远在幕布画面外。
3. **光束起点分散**：`beamStart = P + dMid*1.6 + perp*cos(ang)*0.22 + up*sin(ang)*0.16`，三束按 ang = -0.42 / 0 / +0.42 沿三个面散开，起点不压在棱镜本体。
4. **shader 起点淡入**：`smoothstep(0.0, 0.20, vUv.x)` → 棱镜侧 20% 长度完全透明，棱镜不被光覆盖。
5. **去所有动态**：删除 `prismYaw += 0.0045`（自转）、`prismGroup.position.y` 浮空、光斑呼吸 `sin`、三段折线 `perp*sin(t)` 摆动；shader 去掉 `uTime/flick`；尘埃位置不更新（静止）。**loop 只剩相机视差 + composer.render**。
6. **棱镜内部单条静态光路**：`innerCore` 一条直线（entrance 略前 → exit），opacity 0.55；`innerSeg2/3` opacity 0。`layoutLightPath()` 在 `buildBeams` / `pointerup` / `nextSchedule` 后各调一次。
7. **canvas 投影感**：模块白色描边（lineWidth 2, opacity 0.16）；"被投影光映照"右下暖→左上微冷线性渐变覆盖（极淡 0.05 alpha，不影响可读性）。
8. **幕布外沿光晕**：4 个 Sprite（haloTex 径向渐变）z = -3.35 贴在幕布后，被幕布本体遮挡中间 → 只在 frame 外渗出柔光；颜色随排程第一色同步（`setHaloColor`）。
9. **静态尘埃**：140 个 `Points`（size 0.012，位置不更新）作空气感，不飘落。

---

## 通用技术要点（复用）

### Three.js 用 emissiveMap 显示 Canvas 内容
- **必须 `color: 0x000000`**，否则 envMap/hemisphere 把整块面打白（与 emissive 强度无关）。
- Canvas 必须画**深色底**（`fillRect('#171b26')`），透明背景会被环境光填亮。
- Bloom 阈值配合调（v9：`strength 0.28 / threshold 0.85`），否则发光面整片爆白。

### 光束（Plane + Shader）
- 几何：`PlaneGeometry(1, width)`，每帧 `scale.set(len, 1, 1)` + `quaternion.setFromUnitVectors(+x, dir)` 实现可变长度/朝向。
- 质感层次：`core`（细亮高斯）+ `halo`（宽淡高斯）× `lenf`（首尾淡出）+ `head`（落点亮斑）。
- 颜色拟真：`mix(vec3(1.0), uColor, baseMix)` → 白里透彩，而非饱和彩条。
- **GLSL 严格类型**：所有插值数值要 `toFixed(3)` 成浮点字面量，否则 `float / int` 编译错。

### 调试流程（无 GUI 也能量化验证）
- 用 playwright headless + `--use-gl=angle --enable-unsafe-swiftshader` 截图，捕获 `pageerror` / console error。
- 需要代理时给 chromium 传 `--proxy-server=http://127.0.0.1:7890`。
- 把关键 canvas 挂 `window.__xxx` 后 `toDataURL` 导出，区分"数据问题 / 渲染问题"。

### 已知待办
- 幕布换整周排程（7 列 × 时段行）
- 光束落点联动真实课表 + `campus_map.json`
- 数据接入后端画像 / RAG（现为 mock 三版）
- 手机端降级（Canvas 2D + 纵向）
