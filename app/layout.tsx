import { Inter } from "next/font/google";
import type { Metadata } from "next";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "MaTive — Creative Content Operations Platform",
  description:
    "MaTive: satu workspace untuk merencanakan, membuat, menyetujui, mempublikasikan, mengukur, dan meningkatkan konten. (Plan • Create • Collaborate • Approve • Publish • Analyze)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
