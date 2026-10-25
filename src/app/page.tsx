import React from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bot,
  Rocket,
  ShieldCheck,
  Target,
} from 'lucide-react';

export default function HomePage() {
  const modules = [
    {
      href: '/marketing/attribution',
      badge: 'Phase 1 • Core BI',
      title: 'Marketer Attribution Command Center',
      description:
        'Full-funnel Click-to-Messenger & IG DM attribution table joining Meta Insights with CRM Qualified, Pending ₱, Closed Won ₱, True CPA, True ROAS, Window Shopper Trap badges, and 1-Click Live Ad Status toggles.',
      icon: Target,
      accent: 'from-indigo-500/20 to-slate-900 border-indigo-500/30 text-indigo-300',
    },
    {
      href: '/marketing/watchdog',
      badge: 'Phase 2 • Autonomous Guard',
      title: '24/7 Ad Watchdog & AI Comment-to-DM Shield',
      description:
        'Configure automated stop-loss rules with 48-hour Pending CRM Pipeline protection, price-inquiry keyword triggers, Private Reply DM templates, competitor comment auto-hiding, and Gemini 2.5 Flash moderation.',
      icon: ShieldCheck,
      accent: 'from-amber-500/20 to-slate-900 border-amber-500/30 text-amber-300',
    },
    {
      href: '/marketing/launcher',
      badge: 'Phase 3 • Bulk Publisher',
      title: '60-Second Bulk Ad Launcher Studio',
      description:
        'Enforce standardized taxonomy naming (YYYY-MM_Promo_Format_Creator_V#), batch-upload image/video creatives, generate 3 AI copy angles with Gemini, attach Messenger Icebreakers, and push to Meta Ads Manager.',
      icon: Rocket,
      accent: 'from-emerald-500/20 to-slate-900 border-emerald-500/30 text-emerald-300',
    },
    {
      href: '/marketing/attribution',
      badge: 'Phase 1 • Client & Exec Portal',
      title: 'Simplified Executive & Client Report Portal',
      description:
        'Jargon-free executive dashboard (/exec-report/[token]) with auto-generated 3-bullet plain-English takeaways, 4 bold Money KPI cards, visual Chat-to-Cash conversion funnel, and Top 3 Winning Ads showcase.',
      icon: BarChart3,
      accent: 'from-sky-500/20 to-slate-900 border-sky-500/30 text-sky-300',
    },
  ];

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl w-full space-y-10">
        <div className="text-center space-y-3 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 rounded-full bg-indigo-500/10 px-3.5 py-1.5 text-xs font-semibold text-indigo-300 ring-1 ring-inset ring-indigo-500/30">
            <Activity className="h-3.5 w-3.5" />
            Bridge-Ready Modular Architecture (`mkt_*` Schema)
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white">
            Meta Marketing Attribution &amp; Executive BI
          </h1>
          <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
            Select a workspace module below to inspect attribution telemetry, manage 24/7 Watchdog &amp; Comment Shield rules, launch Click-to-Message ads in bulk, or view the tokenized Executive Report.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {modules.map((mod) => {
            const IconComponent = mod.icon;
            return (
              <Link
                key={mod.title}
                href={mod.href}
                className={`group flex flex-col justify-between rounded-3xl border bg-gradient-to-br ${mod.accent} p-7 shadow-xl hover:scale-[1.01] transition-all`}
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="rounded-full bg-slate-950/70 px-3 py-1 text-xs font-bold uppercase tracking-wider">
                      {mod.badge}
                    </span>
                    <div className="rounded-2xl bg-slate-950/80 p-3 text-white">
                      <IconComponent className="h-6 w-6" />
                    </div>
                  </div>
                  <h2 className="text-xl sm:text-2xl font-bold text-white group-hover:text-indigo-200 transition">
                    {mod.title}
                  </h2>
                  <p className="text-sm text-slate-300 leading-relaxed">
                    {mod.description}
                  </p>
                </div>

                <div className="mt-6 pt-4 border-t border-slate-800/70 flex items-center justify-between text-xs font-bold text-white">
                  <span>Open Module</span>
                  <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </main>
  );
}

