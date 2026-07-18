import type { Metadata } from "next";
import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chess Review Lab",
  description: "Stockfish-powered game reviews and puzzles from your own games.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
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
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-700 text-lg text-white shadow-sm">♞</span>
              <span className="hidden sm:inline">Review Lab</span>
            </Link>
            <nav className="flex items-center gap-1 rounded-xl bg-white/80 p-1 text-sm shadow-sm ring-1 ring-stone-200 dark:bg-stone-900/80 dark:ring-stone-700" aria-label="Primary navigation">
              <Link href="/games" className="rounded-lg px-2 py-1.5 font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white sm:px-3">Games</Link>
              <Link href="/analysis" className="rounded-lg px-2 py-1.5 font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white sm:px-3">Analysis</Link>
              <Link href="/insights" className="rounded-lg px-2 py-1.5 font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white sm:px-3">Insights</Link>
              <Link href="/puzzles" className="rounded-lg px-2 py-1.5 font-medium text-stone-600 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-white sm:px-3">Puzzles</Link>
              <ThemeToggle />
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
