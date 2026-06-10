import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import PointsBadge from "@/components/PointsBadge";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Crypto Debate Arena",
  description: "Bull vs Bear — AI personas debate any crypto asset in real time.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="sticky top-0 z-40 border-b border-panel-border bg-background/80 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="text-bull">🐂</span>
              <span className="text-sm uppercase tracking-[0.2em] text-foreground/90">
                Crypto Debate Arena
              </span>
              <span className="text-bear">🐻</span>
            </Link>
            <nav className="flex items-center gap-6 text-sm text-foreground/70">
              <Link href="/arena" className="transition hover:text-foreground">
                Arena
              </Link>
              <Link href="/leaderboard" className="transition hover:text-foreground">
                Leaderboard
              </Link>
              <PointsBadge />
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-panel-border py-6 text-center text-xs text-foreground/40">
          Not financial advice. Two AIs yelling at each other for your entertainment.
        </footer>
      </body>
    </html>
  );
}
