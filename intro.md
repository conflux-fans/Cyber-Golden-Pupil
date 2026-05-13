# AI Golden Pupil

本项目旨在创建一个基于人工智能的 Bug 扫描工具, 他的核心功能是通过大模型来分析代码中的潜在问题和漏洞, 从而帮助开发者更快地发现和修复代码中的缺陷.

本工具也可以理解为一个 AI 代码审查 Agent.

## 功能概述

1. 这是一个 CLI 工具, 可以通过命令行界面来使用, 整体使用 typescript 编写, 通过 node 来运行.
2. 该工具使用前需要配置大模型的 API Key, 首批支持的模型包括 kimi k2.6, 智普 GLM 系列 和 openrouter, 小米 mimo 模型.
3. 用户可以指定要扫描的代码目录, 工具会递归地扫描该目录下的所有代码文件, 并使用大模型来分析这些文件中的潜在问题.
4. 扫描结果会以清晰的格式输出, 包括发现的问题类型, 位置和建议的修复方法.

## 核心工作原理

1. 首先根据项目的类型(如 JavaScript, Python, Java 等) 来确定项目的结构和框架.
2. 然后递归地扫描指定目录下的所有代码文件, 并将这些文件的内容发送给大模型进行分析.

## Info 

### 小米 Mimo 模型的 API 端口

1. 兼容 OpenAI 协议: https://token-plan-cn.xiaomimimo.com/v1
2. 兼容 Anthropic 协议: https://token-plan-cn.xiaomimimo.com/anthropic

### Kimi 的 K2.6 模型的 API 端口

1. https://api.moonshot.cn/v1

## 相关产品

1. [Claude Security](https://claude.com/blog/claude-security-public-beta) 
   1. https://www.anthropic.com/news/claude-code-security
   2. https://claude.com/product/claude-security
   3. https://claude.com/solutions/security
2. [OpenAI DayBreak](https://openai.com/daybreak/)