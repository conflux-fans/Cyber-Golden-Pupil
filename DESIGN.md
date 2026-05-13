# Design — Rust 安全扫描工具的实现思路

> 这是项目最初的整体设计分析，记录"为什么这么做"。
>
> - `intro.md` — 项目愿景（用户原始描述）
> - `DESIGN.md`（本文）— 顶层方案与取舍
> - `ARCHITECTURE.md` — 已落地代码的目录结构和扩展点
> - `README.md` — 使用方式

## 一、整体架构（5 层）

```
┌──────────────────────────────────────────┐
│  CLI 层 (commander/yargs + TS)           │  参数、配置、输出格式
├──────────────────────────────────────────┤
│  项目扫描层 (Project Ingestion)           │  Cargo.toml / workspace / 源文件枚举
├──────────────────────────────────────────┤
│  预分析层 (Pre-filter / Static Hints)     │  tree-sitter-rust + 规则筛选
├──────────────────────────────────────────┤
│  LLM 分析层 (Multi-provider client)       │  统一抽象 + 结构化输出
├──────────────────────────────────────────┤
│  报告层 (Reporter)                        │  Terminal / JSON / SARIF / Markdown
└──────────────────────────────────────────┘
```

每一层之间通过明确的数据结构传递（`SourceFile` → `Chunk` → `Finding`），上层不感知下层实现细节，便于后续替换（比如 prefilter 从 regex 升级到 tree-sitter）。

## 二、Rust 项目特有的关注点

LLM 不能漫无目的地扫，要先识别 **Rust 的高风险点**：

| 类别       | 典型模式                                            | 检测线索               |
| ---------- | --------------------------------------------------- | ---------------------- |
| 内存安全   | `unsafe { }`、`transmute`、raw pointer 解引用       | `unsafe` 关键字        |
| Panic 风险 | `unwrap()`、`expect()`、`panic!()`、数组越界        | AST 节点匹配           |
| 整数溢出   | `as` 强转、算术运算未用 `checked_*`                 | wrapping / casting     |
| 并发问题   | `Mutex` 锁顺序、`Arc<RwLock>` 滥用、`Send/Sync` 实现 | 并发原语               |
| FFI        | `extern "C"`、`#[no_mangle]`、`c_void`              | FFI 边界               |
| 反序列化   | serde 自定义 `Deserialize`、bincode 不受信输入      | derive / impl          |
| 注入类     | `sqlx::query!` 拼接、`Command::new` 拼参数           | 字符串拼接到敏感 API   |
| 密码学     | 弱算法（MD5/SHA1）、自实现 crypto、随机数误用       | 已知 crate 调用        |
| 供应链     | `Cargo.toml` 依赖、yanked / 旧版本                  | 已有工具 `cargo audit` |

**关键决策**: 供应链层直接调 `cargo audit`，不让 LLM 去判断 CVE —— 又省 token 又准。

## 三、LLM 调用策略（最关键的取舍）

**纯 LLM 全文扫**（简单 / 贵 / 容易漏长上下文）vs. **混合（推荐）**：

1. **粗筛** — 用 `tree-sitter-rust` 解析 AST，按规则标记可疑函数/块（含 `unsafe`、调 FFI、网络/文件/进程操作、密码学等）。
2. **切片** — 以**函数为单位**送给 LLM，附带上下文（调用方/被调方签名、所在模块的 `use` 语句）。比按行/文件切更准。
3. **深度分析** — 对每片调用 LLM，要求返回 **结构化 JSON**（zod schema 校验），字段建议：
   ```ts
   {
     rule_id, severity, cwe,
     file, line_start, line_end,
     summary, evidence, fix_suggestion,
     confidence
   }
   ```
4. **二次确认（可选）** — 对高严重度低置信度的 finding 再喂一次完整上下文做 LLM-as-judge，过滤幻觉。

> ✅ 已落地：`src/scanner/ast.ts` 使用 `tree-sitter-rust` 做真正的函数级切片（`--unit ast-function`，默认）。regex 窗口模式（`--unit function`）保留作为解析失败时的降级路径，以及无 tree-sitter 环境下的兜底。

## 四、多模型抽象

`intro.md` 列出的 4 家供应商（Kimi / GLM / OpenRouter / Mimo），加上 Mimo 的双协议，整体落到两套 client：

| 模型           | 协议                 | 备注                       |
| -------------- | -------------------- | -------------------------- |
| Kimi K2.6      | OpenAI 兼容          | 长上下文友好；temperature 必须 1 |
| 智谱 GLM       | OpenAI 兼容          |                            |
| OpenRouter     | OpenAI 兼容（聚合）  | 一个 key 多模型            |
| 小米 Mimo      | OpenAI **或** Anthropic 兼容 | 双协议                     |

**实现选择**: 内部只维护两套 client：

- `OpenAICompatibleClient`（用 `openai` SDK）
- `AnthropicCompatibleClient`（用 `@anthropic-ai/sdk`）

每个 provider 只是 baseURL + model name + 兼容性 flag（如 `fixedTemperature`、`supportsJsonMode`）的差异，写在 `src/config/index.ts` 的注册表里。**加新 vendor = 加一行配置**。

## 五、技术选型清单

| 用途           | 选择                                      |
| -------------- | ----------------------------------------- |
| CLI            | `commander` + `chalk` + `ora`             |
| AST            | `tree-sitter` + `tree-sitter-rust`（已落地）|
| 文件遍历       | `globby`（自动读 `.gitignore`）           |
| 并发控制       | `p-limit`（避免限流 / 失控花钱）          |
| Schema 校验    | `zod`（强制结构化输出）                   |
| 报告           | 自带 terminal renderer + JSON；SARIF 待补 |
| 配置           | `dotenv`                                  |

## 六、几个容易踩坑的点

1. **成本失控** — 必须先做粗筛和按函数切片，并加 `--max-files` / `--concurrency` 兜底。
2. **幻觉** — 强制 LLM 返回 `evidence`（贴源码片段），后处理时验证该片段确实存在于文件中，否则丢弃。这一步 `analyzer/runner.ts` 已经做了。
3. **Workspace** — Cargo workspace 是多 crate 的，`scanner/project.ts` 用 `smol-toml` 解析 `[workspace].members`（支持 glob），每个文件归属到**最内层** crate，CLI 提供 `--crate <name>` 过滤。✅ 已实现。
4. **生成代码** — `target/`、`build.rs` 产物要排除。
5. **vendor 兼容性** — 国产 OpenAI 兼容端口经常在细节上出问题：
   - Kimi 的 `temperature` 只能是 `1`
   - 部分 vendor 不接受 `response_format: { type: "json_object" }`
   - 必须强制要求用户在 `.env` 里写真实的 model id（不要给一个猜的默认值）

## 七、Non-goals（第一版不做）

- **多语言** — 只支持 Rust。`SourceFile.language` 留了字段位置，未来扩展。
- **结果缓存** — 每次重新分析。等成本成为问题再做内容哈希缓存。
- **自动修复** — 只产 `fix_suggestion` 文本，不动源码。
- **CI 集成** — SARIF / GitHub Code Scanning 输出待补。
