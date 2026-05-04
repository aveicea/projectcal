import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Y2K Project Calendar",
  description: "Notion DB 기반 가로 타임라인 프로젝트 캘린더 위젯",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" suppressHydrationWarning style={{ background: "transparent", backgroundColor: "transparent" }}>
      <body suppressHydrationWarning style={{ background: "transparent", backgroundColor: "transparent", margin: 0, padding: 0 }}>
        {children}
      </body>
    </html>
  );
}
