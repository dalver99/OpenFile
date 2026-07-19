import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import ThemeToggle from "@/components/ThemeToggle";
import { localConfig } from "@/server/database/config";
import { language, messages } from "@/i18n/messages";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000"),
  title: {
    default: "OpenFile — Local chess review",
    template: "%s · OpenFile",
  },
  description: "Private, local-first chess game reviews, position analysis, insights, and puzzles powered by your own Stockfish.",
  applicationName: "OpenFile",
  keywords: ["chess analysis", "Stockfish", "game review", "chess puzzles", "local-first", "open source"],
  creator: "OpenFile contributors",
  publisher: "OpenFile",
  category: "Chess",
  openGraph: {
    type: "website",
    siteName: "OpenFile",
    locale: "en_US",
    title: "OpenFile — Your games, deeply understood",
    description: "Review your Chess.com games locally, explore with Stockfish, and train puzzles generated from your own mistakes.",
  },
  twitter: {
    card: "summary_large_image",
    title: "OpenFile — Local chess review",
    description: "Private Stockfish reviews, analysis, insights, and puzzles from your own games.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const lang = language(localConfig().language);
  const text = messages[lang];
  return (
    <html lang={lang} className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{const t=localStorage.getItem("review-lab-theme");const d=t? t==="dark" : matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light"}catch(e){}`,
          }}
        />
      </head>
      <body className="flex min-h-full flex-col">
        <header className="sticky top-0 z-50 border-b border-stone-200/80 bg-[#f7f6f2]/90 backdrop-blur dark:border-stone-800/80 dark:bg-stone-950/90">
          <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-center px-4 sm:justify-between sm:px-6">
            <Link href="/games" className="hidden items-center gap-2.5 font-black tracking-tight text-stone-900 dark:text-stone-50 sm:flex">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 p-1.5 shadow-sm ring-1 ring-brand-100 dark:bg-stone-900 dark:ring-brand-900">
                <Image src="/brand/openfile-mark.png" alt="" width={28} height={28} priority />
              </span>
              <span className="hidden sm:inline">{text.brand}</span>
            </Link>
            <nav className="flex items-center gap-0.5 rounded-xl bg-white/80 p-1 text-xs shadow-sm ring-1 ring-stone-200 dark:bg-stone-900/80 dark:ring-stone-700 sm:gap-1 sm:text-sm" aria-label="Primary navigation">
              <Link href="/games" className="rounded-lg px-1.5 py-1.5 font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white sm:px-3">{text.nav.games}</Link>
              <Link href="/engine" className="rounded-lg px-1.5 py-1.5 font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white sm:px-3">{text.nav.engine}</Link>
              <Link href="/collections" className="hidden rounded-lg px-1.5 py-1.5 font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white md:block sm:px-3">{text.nav.collections}</Link>
              <Link href="/analysis" className="rounded-lg px-1.5 py-1.5 font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white sm:px-3">{text.nav.analysis}</Link>
              <Link href="/insights" className="rounded-lg px-1.5 py-1.5 font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white sm:px-3">{text.nav.insights}</Link>
              <Link href="/puzzles" className="rounded-lg px-1.5 py-1.5 font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white sm:px-3">{text.nav.puzzles}</Link>
              <Link href="/automation" className="rounded-lg px-1.5 py-1.5 font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white sm:px-3"><span className="sm:hidden">{text.nav.automationShort}</span><span className="hidden sm:inline">{text.nav.automation}</span></Link>
              <ThemeToggle />
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
