# 🤖 AI Code Review Platform

**[English & Persian Documentation]**

The **AI Code Review Platform** is an agentic, scalable, and multi-provider code review application designed to automatically detect security vulnerabilities, performance regressions, logical bugs, architectural antipatterns, and style violations across Git diffs and codebases.

**🔗 [View Official Landing Page](https://your-username.github.io/ai-review-platform/) (Update URL when deploying to GitHub Pages)**

---

## 🌍 About the Project (English)

The **AI Code Review Platform** is a powerful, multi-agent automated code review system. It acts as an intelligent pair programmer, seamlessly integrating with your git workflow (GitLab, local diffs, etc.) to analyze code changes, detect bugs, and suggest improvements.

### ✨ Key Features
- 🤖 **13 Specialized Review Personas**: Focused agents tailored for React, TypeScript, Next.js, Angular, Vue, .NET/C#, Python, Android (Kotlin/Java), iOS (Swift), React Native, Security, Performance, and General Code Quality.
- ⚡ **Pre-LLM Deterministic Rule Engine**: Zero-cost regex and pattern analysis to immediately detect hardcoded secrets, SQL injection, eval usage, wildcard CORS, console logs, and anti-patterns with 100% confidence.
- 🎯 **Smart Routing & Planner**: Evaluates diffs and changed file extensions to invoke only relevant specialists, minimizing latency and LLM token usage.
- 🔌 **Provider-Agnostic LLM Engine**: Native support for **Google Gemini, OpenAI, Anthropic, OpenRouter, Avalai, DeepSeek, Ollama (Local AI), Azure**, and custom OpenAI-compatible proxies. 
- 🎛️ **Provider Management**: Toggle providers on/off, set active defaults, fetch models lists, and control API usage budgets.
- 🦊 **GitLab Integration**: Fetches MR diffs and publishes inline discussions and review summaries directly via GitLab REST API v4.
- 🖥️ **Interactive Web & Desktop UI**: Real-time review execution with Server-Sent Events (SSE), interactive diff visualizer, historical review archive, and Electron desktop packaging.

---

## 🇮🇷 درباره پروژه (فارسی)

**پلتفرم بررسی هوشمند کد (AI Code Review)** یک سیستم خودکار و چندعامله (Multi-Agent) است که مانند یک برنامه‌نویس ارشد در کنار شما قرار می‌گیرد. این پلتفرم با تحلیل کدهای جدید (از طریق GitLab یا فایل‌های Local)، باگ‌ها را شناسایی کرده و راهکارهای بهینه‌سازی پیشنهاد می‌دهد.

### ✨ ویژگی‌های کلیدی
- 🤖 **۱۳ ارزیاب متخصص**: شامل ایجنت‌های تخصصی برای React، TypeScript، Python، Android، امنیت (Security)، پرفورمنس و ...
- ⚡ **موتور بررسی قطعی (بدون هزینه)**: شناسایی فوری مشکلاتی مثل کلیدهای لو رفته، SQL Injection، و کدهای خطرناک بدون نیاز به مصرف توکن‌های هوش مصنوعی.
- 🎯 **مسیریابی هوشمند**: بررسی نوع فایل‌های تغییر یافته و ارجاع آن‌ها فقط به متخصص مربوطه برای کاهش هزینه و افزایش سرعت.
- 🔌 **پشتیبانی از انواع هوش مصنوعی**: پشتیبانی کامل از **Gemini، OpenAI، Anthropic، OpenRouter، سیستم ایرانی Avalai، DeepSeek، و Ollama (برای پردازش آفلاین/رایگان)**.
- 🎛️ **مدیریت پیشرفته سرویس‌دهنده‌ها**: قابلیت روشن/خاموش کردن، تعیین هوش مصنوعی پیش‌فرض، دریافت مستقیم لیست مدل‌ها و کنترل سقف بودجه (Budget Limit).
- 🦊 **یکپارچگی با گیت‌لب (GitLab)**: امکان دریافت مستقیم Merge Request ها و ثبت خودکار کامنت روی کدهای تغییر یافته در GitLab.
- 🖥️ **رابط کاربری تعاملی (وب و دسکتاپ)**: مشاهده زنده فرآیند بررسی، تاریخچه کد رویوها و پشتیبانی از نسخه دسکتاپ (Electron).

---

## 🏗️ Architecture & Package Status

```
├── apps/
│   ├── web/               # [Active] React + Tailwind CSS + Vite frontend
│   └── api/               # [Active] Standalone Express API definitions
├── packages/
│   ├── orchestrator/      # [Active] Multi-agent pipeline coordinator, planner, & critic
│   ├── config/            # [Active] Deterministic rule registry & engine
│   ├── context-engine/    # [Active] TypeScript AST extraction & context slicing
│   ├── core/              # [Active] Domain types, result types, & interface definitions
│   ├── git/               # [Active] GitLab provider, URL parser, & review publisher
│   ├── llm/               # [Active] Multi-provider OpenAI-compatible LLM client & cache
│   ├── memory/            # [Active] In-memory review history & snapshot store
│   ├── repository/        # [Active] Unified diff parser & local file resolver
│   ├── reporting/         # [Active] Markdown & JSON review renderers
│   ├── shared/            # [Active] Environment loaders, hashing, & telemetry utilities
│   ├── workflow-engine/   # [Abstraction] Graph/DAG execution engine (compiled)
│   ├── agent-runtime/     # [Abstraction] Capability gating runtime (compiled)
│   ├── prompts/           # [Stub] Reserved for externalized prompt templates
│   ├── skills/            # [Stub] Reserved for modular agent skill plugins
│   ├── tools/             # [Stub] Reserved for standalone tool bindings
│   ├── ui/                # [Stub] Reserved for cross-framework UI components
│   └── plugins/           # [Draft] Architecture documentation for plugin ecosystem
├── server.ts              # Full-stack API & development web server
├── main.cjs               # Electron desktop main process entry
└── turbo.json             # Turborepo task pipeline configuration
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: `v18.0.0` or higher
- **npm** (v10+) or **bun**

### 1. Installation
Clone the repository and install dependencies:
```bash
git clone <repository-url>
cd ai-review-platform
npm install
```

### 2. Environment Configuration
Copy `.env.example` to `.env` and set your API keys (can also be done directly in the UI Settings):
```bash
cp .env.example .env
```

### 3. Running Development Server
Start the full-stack server (Express API + Vite React Frontend on port `3000`):
```bash
npm run dev
```
Visit [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🛠️ Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Starts the unified full-stack server in development mode (`tsx server.ts`) |
| `npm run build` | Builds all packages with Turborepo and compiles the server bundle (`dist/server.cjs`) |
| `npm run start` | Launches the compiled production server (`node dist/server.cjs`) |
| `npm run clean` | Cleans build caches and generated artifacts |
| `npm run desktop` | Launches the full-stack server and the Electron desktop application |
| `npm run build:desktop` | Packages the desktop application for macOS, Windows, or Linux |

---

## 📄 License
Private repository maintained for automated AI code review workflows. Version **0.1.0**.
