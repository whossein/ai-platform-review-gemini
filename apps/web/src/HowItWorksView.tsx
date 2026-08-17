import { useState, useEffect } from 'react';
import { 
  Workflow, 
  Zap, 
  SearchCode, 
  BrainCircuit, 
  CheckCircle2, 
  Code2,
  ShieldCheck,
  TerminalSquare,
  Layers,
  Bot,
  FileCheck,
  ChevronDown
} from 'lucide-react';

export function HowItWorksView(): JSX.Element {
  const [activeStep, setActiveStep] = useState<number>(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);
  const [lang, setLang] = useState<'en' | 'fa'>('en');

  // Translations
  const content = {
    en: {
      title: "How AI Review Works",
      subtitle: "Discover the multi-agent orchestration architecture that powers intelligent, accurate, and cost-effective code reviews.",
      autoPlayOn: "Pause Animation",
      autoPlayOff: "Resume Animation",
      deepDive: "Multi-Agent Orchestration",
      deepDive1Title: "Specialist Swarm",
      deepDive1Desc: "Instead of passing the entire codebase to a single, easily confused LLM, the Orchestrator splits the task. It wakes up a specific agent for React components, another for Python backend, and another for Security. They run in parallel, reducing latency and token costs.",
      deepDive2Title: "Deterministic + Probabilistic",
      deepDive2Desc: "Why waste LLM tokens on checking branch names or regex patterns? The system runs a blazing-fast static rule engine first. Only complex, semantic reviews are passed to the expensive AI models.",
      deepDive3Title: "Project-Aware Context",
      deepDive3Desc: "The system dynamically reads docs/contributing/ and .eslintrc. Agents don't just review generic code; they review against your specific repository standards, branch naming conventions, and linting rules.",
      steps: [
        {
          id: 'context',
          title: 'Context Engine',
          description: 'Parses the MR/PR, extracts diffs, codebase context, and dynamically reads local project guidelines from your docs/.',
          color: '#3fb950',
        },
        {
          id: 'static',
          title: 'Static Analysis',
          description: 'Zero-cost deterministic rule engine runs instantly. Checks syntax, basic linting, and branch naming conventions without wasting AI tokens.',
          color: '#d29922',
        },
        {
          id: 'orchestrator',
          title: 'Orchestrator',
          description: 'The master planner. Analyzes the context and selectively wakes up only the specific specialist agents needed for this exact code change.',
          color: '#2f81f7',
        },
        {
          id: 'specialists',
          title: 'Specialist Swarm',
          description: 'Domain-specific AI agents (Frontend, Security, Backend) analyze the code simultaneously in parallel, drastically reducing latency.',
          color: '#a371f7',
        },
        {
          id: 'critic',
          title: 'Critic & Judge',
          description: 'Consolidates all agent findings, removes duplicates, resolves contradictions, and ranks issues by severity.',
          color: '#f85149',
        },
        {
          id: 'report',
          title: 'Final Report',
          description: 'A clean, actionable review is delivered to the developer with exact file locations, rich markdown, and proposed fixes.',
          color: '#3fb950',
        }
      ]
    },
    fa: {
      title: "سیستم چگونه کار می‌کند؟",
      subtitle: "آشنایی با معماری ارکستریشن چند-عاملی (Multi-Agent) که پشت پرده در حال اجرای بررسی‌های هوشمند، دقیق و سریع است.",
      autoPlayOn: "توقف انیمیشن",
      autoPlayOff: "اجرای انیمیشن",
      deepDive: "معماری ارکستریشن چند-عاملی",
      deepDive1Title: "تیم ایجنت‌های متخصص",
      deepDive1Desc: "به جای ارسال کل کد برای یک مدل هوش مصنوعی عمومی که به راحتی گیج می‌شود، ارکستراتور کار را تقسیم می‌کند. یک ایجنت برای فرانت‌اند، یکی برای بک‌اند و یکی برای امنیت بیدار شده و موازی کار می‌کنند.",
      deepDive2Title: "ترکیب قطعی و احتمالی",
      deepDive2Desc: "چرا برای بررسی نام برنچ‌ها توکن‌های هوش مصنوعی را هدر دهیم؟ سیستم ابتدا یک موتور قوانین قطعی و سریع را اجرا می‌کند. فقط کدهای پیچیده به مدل‌های گران‌قیمت AI ارسال می‌شوند.",
      deepDive3Title: "آگاه به ساختار پروژه شما",
      deepDive3Desc: "سیستم فایل‌های راهنمای پروژه شما (مثل docs/) را می‌خواند. ایجنت‌ها صرفاً قوانین عمومی را چک نمی‌کنند، بلکه کد را بر اساس استانداردهای دقیق مخزن شما بررسی می‌کنند.",
      steps: [
        {
          id: 'context',
          title: 'موتور کانتکست (Context)',
          description: 'تغییرات کد (Diff) را دریافت کرده و همزمان فایل‌های راهنما و مستندات اختصاصی پروژه شما (مثل docs/ یا lint) را برای بررسی می‌خواند.',
          color: '#3fb950',
        },
        {
          id: 'static',
          title: 'تحلیل استاتیک (بدون هزینه)',
          description: 'اجرای آنی موتور قوانین قطعی. بررسی‌های اولیه مانند سینتکس و نام‌گذاری برنچ‌ها قبل از درگیر کردن هوش مصنوعی بررسی می‌شوند.',
          color: '#d29922',
        },
        {
          id: 'orchestrator',
          title: 'ارکستراتور (برنامه‌ریز مرکزی)',
          description: 'مغز متفکر سیستم. کانتکست را تحلیل کرده و تصمیم می‌گیرد فقط ایجنت‌های تخصصی مرتبط با این کد خاص را بیدار کند.',
          color: '#2f81f7',
        },
        {
          id: 'specialists',
          title: 'ایجنت‌های متخصص (موازی)',
          description: 'متخصصین هوش مصنوعی در حوزه‌های مختلف (ری‌اکت، امنیت، دیتابیس) همزمان کدها را از زاویه دید خود بررسی می‌کنند تا زمان تحلیل به حداقل برسد.',
          color: '#a371f7',
        },
        {
          id: 'critic',
          title: 'قاضی و ارزیاب نهایی (Critic)',
          description: 'تجمیع تمامی نظرات ایجنت‌ها، حذف هشدارهای تکراری، رفع تناقضات بین آن‌ها و مرتب‌سازی هشدارها بر اساس میزان اهمیت.',
          color: '#f85149',
        },
        {
          id: 'report',
          title: 'گزارش نهایی',
          description: 'تولید یک ریویوی تمیز، یکپارچه و عملیاتی با اشاره دقیق به خطوط کد و ارائه راه‌حل برای توسعه‌دهنده.',
          color: '#3fb950',
        }
      ]
    }
  };

  const t = content[lang];
  const isRtl = lang === 'fa';

  useEffect(() => {
    if (!isAutoPlaying) return;
    const interval = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % 6);
    }, 4500);
    return () => clearInterval(interval);
  }, [isAutoPlaying]);

  return (
    <div 
      className={`how-it-works-view ${isRtl ? 'rtl-mode' : ''}`} 
      dir={isRtl ? 'rtl' : 'ltr'}
      style={{ maxWidth: '1100px', margin: '0 auto', animation: 'fadeIn 0.5s ease-out', fontFamily: isRtl ? 'Vazirmatn, Tahoma, sans-serif' : 'inherit' }}
    >
      <style>{`
        .flow-path {
          stroke: var(--border);
          stroke-width: 3;
          fill: none;
          transition: all 0.5s;
        }
        .flow-path.active {
          stroke: var(--accent);
          stroke-dasharray: 8 8;
          animation: dataFlow 1.5s linear infinite;
        }
        @keyframes dataFlow {
          from { stroke-dashoffset: 16; }
          to { stroke-dashoffset: 0; }
        }
        .rtl-mode .flow-path.active {
          animation: dataFlowRtl 1.5s linear infinite;
        }
        @keyframes dataFlowRtl {
          from { stroke-dashoffset: -16; }
          to { stroke-dashoffset: 0; }
        }
        .graph-node {
          position: absolute;
          transform: translate(-50%, -50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          cursor: pointer;
          transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
          z-index: 10;
        }
        .graph-node:hover {
          transform: translate(-50%, -50%) scale(1.1);
        }
        .graph-node.active .icon-box {
          box-shadow: 0 0 25px currentColor;
          border-color: currentColor;
          background: var(--bg);
        }
        .icon-box {
          width: 54px;
          height: 54px;
          border-radius: 14px;
          background: var(--panel);
          border: 2px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.4s;
          color: var(--muted);
        }
        .graph-node.active .icon-box {
          color: currentColor;
        }
        .node-label {
          margin-top: 0.5rem;
          font-size: 0.8rem;
          font-weight: 600;
          color: var(--muted);
          white-space: nowrap;
          transition: color 0.3s;
        }
        .graph-node.active .node-label {
          color: var(--text);
        }
        
        .language-toggle {
          display: flex;
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 20px;
          padding: 4px;
          overflow: hidden;
        }
        .lang-btn {
          background: transparent;
          border: none;
          padding: 6px 14px;
          font-size: 0.85rem;
          font-weight: 600;
          color: var(--muted);
          border-radius: 16px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .lang-btn.active {
          background: var(--accent);
          color: white;
        }

        .accordion-container {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          margin-bottom: 3rem;
        }
        .accordion-item {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 12px;
          overflow: hidden;
          transition: border-color 0.3s, background-color 0.3s;
        }
        .accordion-item.active {
          border-color: var(--accent);
          background: rgba(255, 255, 255, 0.02);
        }
        .accordion-header {
          padding: 1.25rem 1.5rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: space-between;
          user-select: none;
        }
        .accordion-header-left {
          display: flex;
          align-items: center;
          gap: 1rem;
        }
        .accordion-number {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 0.95rem;
          transition: all 0.3s;
        }
        .accordion-title {
          margin: 0;
          font-size: 1.1rem;
          transition: color 0.3s;
          color: var(--text);
        }
        .accordion-icon {
          transition: transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
          color: var(--muted);
        }
        .accordion-item.active .accordion-icon {
          transform: rotate(180deg);
          color: var(--accent);
        }
        .accordion-content {
          max-height: 0;
          overflow: hidden;
          transition: max-height 0.4s ease-out, padding 0.4s ease-out;
          padding: 0 1.5rem;
        }
        .accordion-item.active .accordion-content {
          max-height: 200px;
          padding: 0 1.5rem 1.5rem 1.5rem;
        }
        .accordion-desc {
          margin: 0;
          color: var(--muted);
          font-size: 0.95rem;
          line-height: 1.6;
          padding-left: calc(32px + 1rem); /* Align with text */
        }
        .rtl-mode .accordion-desc {
          padding-left: 0;
          padding-right: calc(32px + 1rem);
        }

        /* Responsive adjustments for Vector Graphic */
        @media (max-width: 768px) {
          .vector-graph-container {
            display: none;
          }
        }
      `}</style>

      {/* Header & Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '3rem', flexDirection: 'row' }}>
        <div style={{ flex: 1, textAlign: isRtl ? 'right' : 'left' }}>
          <h2 style={{ fontSize: '2.2rem', marginBottom: '0.75rem', background: 'linear-gradient(90deg, #fff, #8b949e)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            {t.title}
          </h2>
          <p style={{ color: 'var(--muted)', fontSize: '1.05rem', maxWidth: '700px', lineHeight: 1.6, margin: 0 }}>
            {t.subtitle}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '1rem' }}>
          <div className="language-toggle" dir="ltr">
            <button className={`lang-btn ${lang === 'en' ? 'active' : ''}`} onClick={() => setLang('en')}>EN</button>
            <button className={`lang-btn ${lang === 'fa' ? 'active' : ''}`} onClick={() => setLang('fa')}>فا</button>
          </div>
          <button 
            className="secondary-button" 
            style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem', opacity: 0.8 }}
            onClick={() => setIsAutoPlaying(!isAutoPlaying)}
          >
            {isAutoPlaying ? `⏸ ${t.autoPlayOn}` : `▶️ ${t.autoPlayOff}`}
          </button>
        </div>
      </div>

      {/* Interactive Vector Graph (Desktop) */}
      <div className="vector-graph-container" style={{ position: 'relative', width: '100%', aspectRatio: '1000/400', minHeight: '300px', marginBottom: '3rem', userSelect: 'none' }}>
        
        {/* Background SVG for Paths */}
        <svg width="100%" height="100%" viewBox="0 0 1000 400" style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible' }}>
          {/* Context -> Static */}
          <path className={`flow-path ${activeStep >= 0 ? 'active' : ''}`} d={isRtl ? "M 900 200 L 740 200" : "M 100 200 L 260 200"} />
          {/* Static -> Orch */}
          <path className={`flow-path ${activeStep >= 1 ? 'active' : ''}`} d={isRtl ? "M 740 200 L 580 200" : "M 260 200 L 420 200"} />
          
          {/* Orch -> Specialists (Top, Mid, Bot) */}
          <path className={`flow-path ${activeStep >= 2 ? 'active' : ''}`} d={isRtl ? "M 580 200 C 500 200, 500 80, 380 80" : "M 420 200 C 500 200, 500 80, 620 80"} />
          <path className={`flow-path ${activeStep >= 2 ? 'active' : ''}`} d={isRtl ? "M 580 200 L 380 200" : "M 420 200 L 620 200"} />
          <path className={`flow-path ${activeStep >= 2 ? 'active' : ''}`} d={isRtl ? "M 580 200 C 500 200, 500 320, 380 320" : "M 420 200 C 500 200, 500 320, 620 320"} />
          
          {/* Specialists -> Critic */}
          <path className={`flow-path ${activeStep >= 3 ? 'active' : ''}`} d={isRtl ? "M 380 80 C 280 80, 280 200, 180 200" : "M 620 80 C 720 80, 720 200, 820 200"} />
          <path className={`flow-path ${activeStep >= 3 ? 'active' : ''}`} d={isRtl ? "M 380 200 L 180 200" : "M 620 200 L 820 200"} />
          <path className={`flow-path ${activeStep >= 3 ? 'active' : ''}`} d={isRtl ? "M 380 320 C 280 320, 280 200, 180 200" : "M 620 320 C 720 320, 720 200, 820 200"} />
          
          {/* Critic -> Report */}
          <path className={`flow-path ${activeStep >= 4 ? 'active' : ''}`} d={isRtl ? "M 180 200 L 50 200" : "M 820 200 L 950 200"} />
        </svg>

        {/* HTML Absolute Nodes */}
        {/* 0: Context Engine */}
        <div className={`graph-node ${activeStep === 0 ? 'active' : ''}`} style={{ left: isRtl ? '90%' : '10%', top: '50%', color: t.steps[0]!.color }} onClick={() => { setActiveStep(0); setIsAutoPlaying(false); }}>
          <div className="icon-box"><SearchCode size={28} /></div>
          <div className="node-label">{t.steps[0]!.title.split(' ')[0]}</div>
        </div>

        {/* 1: Static Engine */}
        <div className={`graph-node ${activeStep === 1 ? 'active' : ''}`} style={{ left: isRtl ? '74%' : '26%', top: '50%', color: t.steps[1]!.color }} onClick={() => { setActiveStep(1); setIsAutoPlaying(false); }}>
          <div className="icon-box"><Zap size={28} /></div>
          <div className="node-label">{isRtl ? 'استاتیک' : 'Static'}</div>
        </div>

        {/* 2: Orchestrator */}
        <div className={`graph-node ${activeStep === 2 ? 'active' : ''}`} style={{ left: isRtl ? '58%' : '42%', top: '50%', color: t.steps[2]!.color }} onClick={() => { setActiveStep(2); setIsAutoPlaying(false); }}>
          <div className="icon-box"><Workflow size={28} /></div>
          <div className="node-label">{isRtl ? 'ارکستراتور' : 'Orchestrator'}</div>
        </div>

        {/* 3: Specialists Swarm (Visualized as 3 nodes) */}
        <div className={`graph-node ${activeStep === 3 ? 'active' : ''}`} style={{ left: isRtl ? '38%' : '62%', top: '20%', color: t.steps[3]!.color }} onClick={() => { setActiveStep(3); setIsAutoPlaying(false); }}>
          <div className="icon-box"><Code2 size={24} /></div>
          <div className="node-label">{isRtl ? 'ایجنت فرانت' : 'Frontend'}</div>
        </div>
        <div className={`graph-node ${activeStep === 3 ? 'active' : ''}`} style={{ left: isRtl ? '38%' : '62%', top: '50%', color: t.steps[3]!.color }} onClick={() => { setActiveStep(3); setIsAutoPlaying(false); }}>
          <div className="icon-box"><ShieldCheck size={24} /></div>
          <div className="node-label">{isRtl ? 'ایجنت امنیت' : 'Security'}</div>
        </div>
        <div className={`graph-node ${activeStep === 3 ? 'active' : ''}`} style={{ left: isRtl ? '38%' : '62%', top: '80%', color: t.steps[3]!.color }} onClick={() => { setActiveStep(3); setIsAutoPlaying(false); }}>
          <div className="icon-box"><TerminalSquare size={24} /></div>
          <div className="node-label">{isRtl ? 'ایجنت بک‌اند' : 'Backend'}</div>
        </div>

        {/* 4: Critic */}
        <div className={`graph-node ${activeStep === 4 ? 'active' : ''}`} style={{ left: isRtl ? '18%' : '82%', top: '50%', color: t.steps[4]!.color }} onClick={() => { setActiveStep(4); setIsAutoPlaying(false); }}>
          <div className="icon-box"><BrainCircuit size={28} /></div>
          <div className="node-label">{isRtl ? 'ارزیاب (Critic)' : 'Critic'}</div>
        </div>

        {/* 5: Final Report */}
        <div className={`graph-node ${activeStep === 5 ? 'active' : ''}`} style={{ left: isRtl ? '5%' : '95%', top: '50%', color: t.steps[5]!.color }} onClick={() => { setActiveStep(5); setIsAutoPlaying(false); }}>
          <div className="icon-box"><CheckCircle2 size={28} /></div>
          <div className="node-label">{isRtl ? 'گزارش' : 'Report'}</div>
        </div>
      </div>

      {/* Dynamic Details / Accordion Box */}
      <div className="accordion-container">
        {t.steps.map((step, index) => {
          const isActive = activeStep === index;
          return (
            <div 
              key={step.id} 
              className={`accordion-item ${isActive ? 'active' : ''}`}
              style={isActive ? { '--accent': step.color } as any : {}}
            >
              <div 
                className="accordion-header" 
                onClick={() => { setActiveStep(index); setIsAutoPlaying(false); }}
              >
                <div className="accordion-header-left">
                  <div className="accordion-number" style={{
                    background: isActive ? `${step.color}20` : 'transparent',
                    color: isActive ? step.color : 'var(--muted)',
                    border: `1px solid ${isActive ? 'transparent' : 'var(--border)'}`
                  }}>
                    {index + 1}
                  </div>
                  <h3 className="accordion-title" style={{ color: isActive ? step.color : 'var(--text)' }}>
                    {step.title}
                  </h3>
                </div>
                <ChevronDown className="accordion-icon" size={20} />
              </div>
              <div className="accordion-content">
                <p className="accordion-desc">
                  {step.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Deep Dive Section */}
      <div className="deep-dive" style={{ 
        background: 'var(--panel)', 
        border: '1px solid var(--border)', 
        borderRadius: '16px', 
        padding: '2.5rem',
        marginTop: '3rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
          <Layers size={32} color="var(--accent)" />
          <h3 style={{ margin: 0, fontSize: '1.5rem' }}>{t.deepDive}</h3>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
          <div>
            <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text)', marginBottom: '1rem' }}>
              <Bot size={20} color="#a371f7" />
              {t.deepDive1Title}
            </h4>
            <p style={{ color: 'var(--muted)', fontSize: '0.95rem', lineHeight: 1.6 }}>
              {t.deepDive1Desc}
            </p>
          </div>
          <div>
            <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text)', marginBottom: '1rem' }}>
              <ShieldCheck size={20} color="#3fb950" />
              {t.deepDive2Title}
            </h4>
            <p style={{ color: 'var(--muted)', fontSize: '0.95rem', lineHeight: 1.6 }}>
              {t.deepDive2Desc}
            </p>
          </div>
          <div>
            <h4 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text)', marginBottom: '1rem' }}>
              <FileCheck size={20} color="#d29922" />
              {t.deepDive3Title}
            </h4>
            <p style={{ color: 'var(--muted)', fontSize: '0.95rem', lineHeight: 1.6 }}>
              {t.deepDive3Desc}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
