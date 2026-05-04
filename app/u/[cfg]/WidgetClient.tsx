"use client";

import { useState, useEffect } from "react";
import CalendarWidget from "@/components/CalendarWidget";
import { DEFAULT_BAR_COLORS } from "@/lib/calendarUtils";

interface Config {
  id: string;
  notionConfig: {
    apiKey: string;
    databaseId: string;
    dateProperty: string;
    titleProperty: string;
  };
  theme: {
    primaryColor: string;
    backgroundColor: string;
    backgroundOpacity: number;
    fontFamily: string;
    barColors: string[];
    labelColor: string;
    multiRow: boolean;
    darkMode: boolean;
  };
  createdAt: string;
  updatedAt: string;
}

export default function WidgetClient({ cfg }: { cfg: string }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [barColors, setBarColors] = useState<string[]>(DEFAULT_BAR_COLORS);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      let base64 = cfg.replace(/-/g, "+").replace(/_/g, "/");
      while (base64.length % 4) base64 += "=";
      const raw = atob(base64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const json = JSON.parse(new TextDecoder().decode(bytes));

      if (Array.isArray(json.barColors)) setBarColors(json.barColors);

      setConfig({
        id: "embedded",
        notionConfig: {
          apiKey: json.token ?? "",
          databaseId: json.dbId ?? "",
          dateProperty: json.dateProp ?? "날짜",
          titleProperty: json.titleProp ?? "제목",
        },
        theme: {
          primaryColor: json.primaryColor ?? "#E8A8C0",
          backgroundColor: json.backgroundColor ?? "#FFFFFF",
          backgroundOpacity: json.backgroundOpacity ?? 100,
          fontFamily: json.fontFamily ?? "Pretendard",
          barColors: Array.isArray(json.barColors) ? json.barColors : DEFAULT_BAR_COLORS,
          labelColor: json.labelColor ?? "#444444",
          multiRow: json.multiRow ?? false,
          darkMode: json.darkMode ?? false,
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error("Config decode error:", e);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [cfg]);

  if (error) {
    return (
      <div style={{ width: "100%", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", color: "#e53e3e", fontFamily: "monospace" }}>
          <h2>위젯 설정 오류</h2>
          <pre style={{ fontSize: 12, background: "#fff5f5", padding: 12, borderRadius: 8 }}>{error}</pre>
        </div>
      </div>
    );
  }

  if (!config) return null;

  const darkMode = config.theme.darkMode;

  return (
    <>
      <style suppressHydrationWarning>{`
        html, body {
          background: ${darkMode ? "#191919" : "transparent"} !important;
          background-color: ${darkMode ? "#191919" : "transparent"} !important;
          margin: 0 !important; padding: 0 !important;
        }
        body {
          padding-top: 20px !important;
          display: flex; justify-content: center;
          align-items: flex-start; min-height: 100vh;
        }
      `}</style>
      <CalendarWidget
        configId="embedded"
        config={config}
        theme={{ ...config.theme, barColors }}
        fontFamily={config.theme.fontFamily}
      />
    </>
  );
}
