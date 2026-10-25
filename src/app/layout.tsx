import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Meta Marketing Attribution & Executive BI Suite',
  description:
    'Bridge-ready Click-to-Messenger & Instagram DM attribution, CAPI loopback, 24/7 Ad Watchdog, AI Comment-to-DM Shield, and 60-Second Bulk Ad Launcher.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-slate-950 text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}

