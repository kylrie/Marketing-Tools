import React from 'react';

export const metadata = {
  title: 'Privacy Policy — Marketing Tool',
  description: 'Privacy Policy and Data Deletion Instructions for Marketing Tool.',
};

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 py-16 px-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-3xl font-bold text-white">Privacy Policy</h1>
        <p className="text-sm text-slate-400">Last updated: October 2026</p>
        <section className="space-y-3 text-sm text-slate-300 leading-relaxed">
          <p>
            Marketing Tool (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;us&rdquo;) operates internal marketing attribution,
            advertising analytics, and business messaging automation services connected to Meta
            platforms (Facebook and Instagram).
          </p>
          <h2 className="text-lg font-semibold text-white pt-4">1. Information We Collect</h2>
          <p>
            When you message our Facebook Page or Instagram account via an advertisement, we receive
            your Page-Scoped User ID (PSID), public profile name, message content, and ad referral
            metadata provided by Meta APIs solely to assist with your inquiry and measure ad performance.
          </p>
          <h2 className="text-lg font-semibold text-white pt-4">2. How We Use Information</h2>
          <p>
            We use collected information strictly to respond to customer inquiries, provide requested
            product or pricing details, and attribute advertising performance. We do not sell or share
            personal data with third parties.
          </p>
          <h2 className="text-lg font-semibold text-white pt-4">3. Data Deletion Instructions</h2>
          <p>
            You may request deletion of your messaging and attribution data at any time by messaging our
            Facebook Page directly with the text &ldquo;DELETE MY DATA&rdquo; or by contacting our support team.
          </p>
        </section>
      </div>
    </main>
  );
}

