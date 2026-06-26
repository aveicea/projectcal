"use client";

import React, { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Settings2, CalendarDays, Type, Palette, Copy, Monitor } from "lucide-react";
import { DEFAULT_BAR_COLORS, Project } from "@/lib/calendarUtils";
import { safeStorage } from "@/lib/safeStorage";

const CalendarWidget = dynamic(() => import("@/components/CalendarWidget"), {
  ssr: false,
  loading: () => <div style={{ height: 120 }} />,
});

const THEMES = [
  { name: "파스텔🌸", colors: { background: "#FFFCF9", primary: "#B5E3F0", barColors: ["#FFB3BA","#E2D1F0","#C6EBC5","#FFDFBA","#BAE1FF","#FFD1DC","#B5EAD7","#FFDAC1"] } },
  { name: "핑크",    colors: { background: "#FFF5F8", primary: "#F19CB6", barColors: ["#FFB3BA","#FFDBE7","#FFD1DC","#F8C8DC","#FF9EC1","#FFC4D6","#FF85A2","#FFE4ED"] } },
  { name: "블랙",    colors: { background: "#1E1E1E", primary: "#4A4A4A", barColors: ["#6B7280","#9CA3AF","#D1D5DB","#E5E7EB","#F3F4F6","#8B5CF6","#EC4899","#F97316"] } },
  { name: "화이트",  colors: { background: "#FFFFFF", primary: "#2D2D2D", barColors: ["#FFB3BA","#E2D1F0","#C6EBC5","#FFDFBA","#BAE1FF","#FFD1DC","#B5EAD7","#FFDAC1"] } },
  { name: "보라",    colors: { background: "#F8F5FF", primary: "#B97FE7", barColors: ["#E2D1F0","#D4B8F0","#C9A0FF","#B388FF","#E8C8FF","#F0D0FF","#D1B3FF","#C7A3FF"] } },
  { name: "그린",    colors: { background: "#F5FBF7", primary: "#66C497", barColors: ["#C6EBC5","#B5EAD7","#A8E6CF","#98D8C8","#88D8B0","#B4F0A7","#C1F0C1","#D0F0C0"] } },
  { name: "블루",    colors: { background: "#F5FAFF", primary: "#5FA3EE", barColors: ["#BAE1FF","#A0C4FF","#BDB2FF","#9BF6FF","#CAF0F8","#ADE8F4","#90E0EF","#48CAE4"] } },
  { name: "노란",    colors: { background: "#FFFEF5", primary: "#FCD34D", barColors: ["#FFDAC1","#FFDFBA","#FFE5B4","#FFEAA7","#FFF3BF","#FFD93D","#FFC93C","#F4D35E"] } },
];

interface GCalCalendar {
  id: string;
  summary: string;
  backgroundColor?: string;
  primary?: boolean;
}

interface Settings {
  databaseId: string;
  apiKey: string;
  dateProperty: string;
  titleProperty: string;
  groupProperty: string;
  groupOptionFilter: string[];
  dependencyProperty: string;
  highlightProperty: string;
  highlightBorderColor: string;
  rowProperty: string;
  doneProperty: string;
  plannerDbId: string;
  plannerToken: string;
  plannerTitleProp: string;
  plannerDateProp: string;
  plannerBookProp: string;
  plannerLinkProp: string;
  parentRelProp: string;
  bookProperty: string;
  primaryColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  fontFamily: string;
  barColors: string[];
  labelColor: string;
  multiRow: boolean;
  darkMode: boolean;
  weekView: boolean;
}

function makePreviewProjects(multiRow: boolean, withDeps = false): Project[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = (day: number) => `${y}-${pad(m + 1)}-${pad(Math.min(day, new Date(y, m + 1, 0).getDate()))}`;
  const base: Project[] = [
    { id: "p1", title: "Website Redesign", startDate: d(1),  endDate: d(4),  pageUrl: "#" },
    { id: "p2", title: "Mobile App MVP",   startDate: d(6),  endDate: d(10), pageUrl: "#" },
    { id: "p3", title: "QA Testing",       startDate: d(12), endDate: d(14), pageUrl: "#" },
    { id: "p4", title: "Final Launch",     startDate: d(17), endDate: d(22), pageUrl: "#" },
    { id: "p5", title: "Design Polish",    startDate: d(21), endDate: d(24), pageUrl: "#" },
  ];
  if (multiRow) {
    base.push(
      { id: "p6", title: "Code Review", startDate: d(6),  endDate: d(9),  pageUrl: "#" },
      { id: "p7", title: "Bug Fixes",   startDate: d(17), endDate: d(20), pageUrl: "#" }
    );
  }
  if (withDeps) {
    // 선행 작업 → 후속 작업 체인 (p1 → p2 → p3 → p4)
    const dep = (id: string, deps: string[]) => {
      const p = base.find((b) => b.id === id);
      if (p) p.dependsOn = deps;
    };
    dep("p2", ["p1"]);
    dep("p3", ["p2"]);
    dep("p4", ["p3"]);
  }
  return base;
}

function OnboardingPageInner() {
  // step: 1=Notion, 2=GCal, 3=Design, 4=Done
  const [step, setStep] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [databases, setDatabases] = useState<{ id: string; title: string }[]>([]);
  // 플래너 연결: 같은(또는 별도) 토큰으로 DB 목록 불러와 선택 + 속성 자동 감지
  const [plannerDatabases, setPlannerDatabases] = useState<{ id: string; title: string }[]>([]);
  const [plannerDbLoading, setPlannerDbLoading] = useState(false);
  const [groupableProperties, setGroupableProperties] = useState<{ name: string; type: string }[]>([]);
  const [checkboxProperties, setCheckboxProperties] = useState<string[]>([]);
  const [rowProperties, setRowProperties] = useState<{ name: string; type: string }[]>([]);
  const [dateProperties, setDateProperties] = useState<string[]>([]);
  const [titleProperties, setTitleProperties] = useState<{ name: string; type: string }[]>([]);
  const [selectedDbName, setSelectedDbName] = useState("");
  const [selectedTheme, setSelectedTheme] = useState("파스텔🌸");
  const [generatedUrl, setGeneratedUrl] = useState("");

  // Google Calendar state
  const [gcalToken, setGcalToken] = useState<string | null>(null);
  const [gcalRefreshToken, setGcalRefreshToken] = useState<string | null>(null);
  const [gcalCalendars, setGcalCalendars] = useState<GCalCalendar[]>([]);
  const [gcalSelectedIds, setGcalSelectedIds] = useState<Set<string>>(new Set());
  const [gcalLoading, setGcalLoading] = useState(false);
  const [gcalSyncTargetCalId, setGcalSyncTargetCalId] = useState("");
  const [gcalShowTimed, setGcalShowTimed] = useState(false);
  const [gcalColorOverrides, setGcalColorOverrides] = useState<Record<string, string>>({});
  const [gcalBorderColorOverrides, setGcalBorderColorOverrides] = useState<Record<string, string>>({});

  // Notion group color state
  const [groupColorOverrides, setGroupColorOverrides] = useState<Record<string, string>>({});
  const [selectOptions, setSelectOptions] = useState<Record<string, string[]>>({});

  const [importUrl, setImportUrl] = useState("");
  const searchParams = useSearchParams();

  // On mount: restore gcal token from localStorage (skipped if ?from= param provides its own token)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (searchParams.get("from")) return; // ?from= flow handles its own token
    const token = safeStorage.getItem("pcal_gcal_token");
    const expiry = safeStorage.getItem("pcal_gcal_expiry");
    const refreshToken = safeStorage.getItem("pcal_gcal_refresh_token");
    if (token && expiry && Date.now() < parseInt(expiry)) {
      setGcalToken(token);
      loadGCalCalendars(token);
    }
    if (refreshToken) setGcalRefreshToken(refreshToken);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-import from ?from= query param
  useEffect(() => {
    const fromParam = searchParams.get("from");
    if (!fromParam) return;
    const run = async () => {
      try {
        let base64 = fromParam.replace(/-/g, "+").replace(/_/g, "/");
        while (base64.length % 4) base64 += "=";
        const raw = atob(base64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        const json = JSON.parse(new TextDecoder().decode(bytes));
        const apiKey = (json.token as string) ?? "";
        const databaseId = (json.dbId as string) ?? "";
        const groupProperty = (json.groupProp as string) ?? "";
        setSettings((prev) => ({
          ...prev,
          apiKey,
          databaseId,
          dateProperty: (json.dateProp as string) ?? prev.dateProperty,
          titleProperty: (json.titleProp as string) ?? prev.titleProperty,
          groupProperty,
          groupOptionFilter: Array.isArray(json.groupFilter) ? json.groupFilter as string[] : [],
          dependencyProperty: (json.dependsProp as string) ?? "",
          highlightProperty: (json.highlightProp as string) ?? "",
          highlightBorderColor: (json.highlightBorderColor as string) ?? "#FF5A5F",
          rowProperty: (json.rowProp as string) ?? "",
          doneProperty: (json.doneProp as string) ?? "",
          plannerDbId: (json.plannerDbId as string) ?? "",
          plannerToken: (json.plannerToken as string) ?? "",
          plannerTitleProp: (json.plannerTitleProp as string) ?? "범위",
          plannerDateProp: (json.plannerDateProp as string) ?? "날짜",
          plannerBookProp: (json.plannerBookProp as string) ?? "책",
          plannerLinkProp: (json.plannerLinkProp as string) ?? "PLANNER",
          parentRelProp: (json.parentRelProp as string) ?? "상위 항목",
          bookProperty: (json.bookProp as string) ?? "책",
          primaryColor: (json.primaryColor as string) ?? prev.primaryColor,
          backgroundColor: (json.backgroundColor as string) ?? prev.backgroundColor,
          backgroundOpacity: (json.backgroundOpacity as number) ?? prev.backgroundOpacity,
          fontFamily: (json.fontFamily as string) ?? prev.fontFamily,
          barColors: Array.isArray(json.barColors) ? json.barColors as string[] : prev.barColors,
          labelColor: (json.labelColor as string) ?? prev.labelColor,
          multiRow: (json.multiRow as boolean) ?? prev.multiRow,
          darkMode: (json.darkMode as boolean) ?? prev.darkMode,
          weekView: (json.weekView as boolean) ?? prev.weekView,
        }));
        if (json.gcalToken) {
          setGcalToken(json.gcalToken as string);
          if (json.gcalRefreshToken) setGcalRefreshToken(json.gcalRefreshToken as string);
          const restoredIds = Array.isArray(json.gcalCalIds) ? new Set(json.gcalCalIds as string[]) : new Set<string>();
          if (restoredIds.size > 0) setGcalSelectedIds(restoredIds);
          if (json.gcalSyncCalId) setGcalSyncTargetCalId(json.gcalSyncCalId as string);
          if (json.gcalShowTimed) setGcalShowTimed(true);
          if (json.gcalCalColors && typeof json.gcalCalColors === "object") setGcalColorOverrides(json.gcalCalColors as Record<string, string>);
          if (json.gcalBorderColors && typeof json.gcalBorderColors === "object") setGcalBorderColorOverrides(json.gcalBorderColors as Record<string, string>);
          loadGCalCalendars(json.gcalToken as string, restoredIds);
        }
        if (json.groupColors && typeof json.groupColors === "object") setGroupColorOverrides(json.groupColors as Record<string, string>);
        setStep(3);
        // Fetch DB properties directly (don't rely on later-defined helpers)
        if (apiKey && databaseId) {
          const res = await fetch("/api/analyze-database", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ apiKey, databaseId, groupProperty: groupProperty || undefined }),
          });
          const data = await res.json();
          if (data.success && data.data) {
            setGroupableProperties(data.data.groupableProperties ?? []);
            setCheckboxProperties(data.data.checkboxProperties ?? []);
            setRowProperties(data.data.rowProperties ?? []);
            setDateProperties(data.data.dateProperties ?? []);
            setTitleProperties(data.data.titleProperties ?? []);
            setSelectOptions(data.data.selectOptions ?? {});
          }
        }
      } catch { /* ignore */ }
    };
    run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleImportUrl = async () => {
    try {
      const trimmed = importUrl.trim();
      const cfgPart = trimmed.includes("/u/") ? trimmed.split("/u/")[1].split("?")[0] : trimmed;
      if (!cfgPart) throw new Error("Invalid URL");
      let base64 = cfgPart.replace(/-/g, "+").replace(/_/g, "/");
      while (base64.length % 4) base64 += "=";
      const raw = atob(base64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const json = JSON.parse(new TextDecoder().decode(bytes));
      const apiKey = (json.token as string) ?? "";
      const databaseId = (json.dbId as string) ?? "";
      const groupProperty = (json.groupProp as string) ?? "";

      setSettings((prev) => ({
        ...prev,
        apiKey,
        databaseId,
        dateProperty: (json.dateProp as string) ?? prev.dateProperty,
        titleProperty: (json.titleProp as string) ?? prev.titleProperty,
        groupProperty,
        dependencyProperty: (json.dependsProp as string) ?? "",
        doneProperty: (json.doneProp as string) ?? "",
        plannerDbId: (json.plannerDbId as string) ?? "",
        plannerToken: (json.plannerToken as string) ?? "",
        plannerTitleProp: (json.plannerTitleProp as string) ?? "범위",
        plannerDateProp: (json.plannerDateProp as string) ?? "날짜",
        plannerBookProp: (json.plannerBookProp as string) ?? "책",
        plannerLinkProp: (json.plannerLinkProp as string) ?? "PLANNER",
        parentRelProp: (json.parentRelProp as string) ?? "상위 항목",
        bookProperty: (json.bookProp as string) ?? "책",
        primaryColor: (json.primaryColor as string) ?? prev.primaryColor,
        backgroundColor: (json.backgroundColor as string) ?? prev.backgroundColor,
        backgroundOpacity: (json.backgroundOpacity as number) ?? prev.backgroundOpacity,
        fontFamily: (json.fontFamily as string) ?? prev.fontFamily,
        barColors: Array.isArray(json.barColors) ? json.barColors as string[] : prev.barColors,
        labelColor: (json.labelColor as string) ?? prev.labelColor,
        multiRow: (json.multiRow as boolean) ?? prev.multiRow,
        darkMode: (json.darkMode as boolean) ?? prev.darkMode,
        weekView: (json.weekView as boolean) ?? prev.weekView,
      }));
      if (json.gcalToken) {
        setGcalToken(json.gcalToken as string);
        if (json.gcalRefreshToken) setGcalRefreshToken(json.gcalRefreshToken as string);
        const restoredIds = Array.isArray(json.gcalCalIds) ? new Set(json.gcalCalIds as string[]) : new Set<string>();
        if (restoredIds.size > 0) setGcalSelectedIds(restoredIds);
        if (json.gcalSyncCalId) setGcalSyncTargetCalId(json.gcalSyncCalId as string);
        if (json.gcalShowTimed) setGcalShowTimed(true);
        if (json.gcalCalColors && typeof json.gcalCalColors === "object") setGcalColorOverrides(json.gcalCalColors as Record<string, string>);
        if (json.gcalBorderColors && typeof json.gcalBorderColors === "object") setGcalBorderColorOverrides(json.gcalBorderColors as Record<string, string>);
        loadGCalCalendars(json.gcalToken as string, restoredIds);
      }
      if (json.groupColors && typeof json.groupColors === "object") setGroupColorOverrides(json.groupColors as Record<string, string>);
      setImportUrl("");
      setErrorMsg(null);
      setStep(2);
      // Fetch DB properties directly
      if (apiKey && databaseId) {
        const res = await fetch("/api/analyze-database", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey, databaseId, groupProperty: groupProperty || undefined }),
        });
        const data = await res.json();
        if (data.success && data.data) {
          setGroupableProperties(data.data.groupableProperties ?? []);
          setDateProperties(data.data.dateProperties ?? []);
          setTitleProperties(data.data.titleProperties ?? []);
          setSelectOptions(data.data.selectOptions ?? {});
        }
      }
    } catch {
      setErrorMsg("올바른 위젯 URL이 아닙니다.");
    }
  };

  const [settings, setSettings] = useState<Settings>({
    databaseId: "",
    apiKey: "",
    dateProperty: "날짜",
    titleProperty: "제목",
    groupProperty: "",
    groupOptionFilter: [],
    dependencyProperty: "",
    highlightProperty: "",
    highlightBorderColor: "#FF5A5F",
    rowProperty: "",
    doneProperty: "",
    plannerDbId: "",
    plannerToken: "",
    plannerTitleProp: "범위",
    plannerDateProp: "날짜",
    plannerBookProp: "책",
    plannerLinkProp: "PLANNER",
    parentRelProp: "상위 항목",
    bookProperty: "책",
    primaryColor: "#B5E3F0",
    backgroundColor: "#FFFCF9",
    backgroundOpacity: 100,
    fontFamily: "Pretendard",
    barColors: [...DEFAULT_BAR_COLORS],
    labelColor: "#444444",
    multiRow: false,
    darkMode: false,
    weekView: false,
  });

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setErrorMsg(null);
  };

  // Auto-load DB properties whenever apiKey+databaseId are set and selectOptions is empty
  useEffect(() => {
    if (!settings.apiKey || !settings.databaseId) return;
    if (Object.keys(selectOptions).length > 0) return;
    fetch("/api/analyze-database", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: settings.apiKey, databaseId: settings.databaseId }),
    })
      .then((res) => res.json())
      .then((json) => {
        if (json.success && json.data) {
          setGroupableProperties(json.data.groupableProperties ?? []);
          setCheckboxProperties(json.data.checkboxProperties ?? []);
          setRowProperties(json.data.rowProperties ?? []);
          setDateProperties(json.data.dateProperties ?? []);
          setTitleProperties(json.data.titleProperties ?? []);
          setSelectOptions(json.data.selectOptions ?? {});
          // 비어 있을 때만 자동 매칭값 채우기 (저장된 명시 선택은 보존)
          setSettings((prev) => ({
            ...prev,
            dependencyProperty: prev.dependencyProperty || (json.data.suggestedDependency ?? ""),
            highlightProperty: prev.highlightProperty || (json.data.suggestedHighlight ?? ""),
            rowProperty: prev.rowProperty || (json.data.suggestedRow ?? ""),
          }));
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.apiKey, settings.databaseId]);

  // When user picks a group property, fetch unique values from pages if not already in selectOptions
  useEffect(() => {
    if (!settings.groupProperty || !settings.apiKey || !settings.databaseId) return;
    if (selectOptions[settings.groupProperty]) return;
    fetch("/api/analyze-database", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: settings.apiKey, databaseId: settings.databaseId, groupProperty: settings.groupProperty }),
    })
      .then((res) => res.json())
      .then((json) => {
        if (json.success && json.data?.selectOptions) {
          setSelectOptions((prev) => ({ ...prev, ...json.data.selectOptions }));
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.groupProperty]);

  // ── Notion ────────────────────────────────────────────────────────────────

  const handleLoadDatabases = async () => {
    if (!settings.apiKey.trim()) { setErrorMsg("Notion API 키를 입력해주세요."); return; }
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/databases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: settings.apiKey }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error?.message || "데이터베이스를 불러오는데 실패했습니다.");
      if (json.data?.length > 0) {
        setDatabases(json.data);
      } else {
        setErrorMsg("연결된 데이터베이스가 없습니다. Notion에서 Integration을 데이터베이스에 연결해주세요.");
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectDatabase = async (dbId: string, dbTitle: string) => {
    update("databaseId", dbId);
    setSelectedDbName(dbTitle);
    setGroupableProperties([]);
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/analyze-database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: settings.apiKey, databaseId: dbId }),
      });
      const json = await res.json();
      if (json.success && json.data) {
        setSettings((prev) => ({
          ...prev,
          databaseId: dbId,
          dateProperty: json.data.dateProperty || prev.dateProperty,
          titleProperty: json.data.titleProperty || prev.titleProperty,
          groupProperty: "",
          dependencyProperty: json.data.suggestedDependency ?? "",
          highlightProperty: json.data.suggestedHighlight ?? "",
          rowProperty: json.data.suggestedRow ?? "",
        }));
        setGroupableProperties(json.data.groupableProperties ?? []);
        setCheckboxProperties(json.data.checkboxProperties ?? []);
        setRowProperties(json.data.rowProperties ?? []);
        setDateProperties(json.data.dateProperties ?? []);
        setTitleProperties(json.data.titleProperties ?? []);
        setSelectOptions(json.data.selectOptions ?? {});
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const loadDbPropertiesQuiet = async (apiKey: string, databaseId: string, groupProperty?: string) => {
    if (!apiKey || !databaseId) return;
    try {
      const res = await fetch("/api/analyze-database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, databaseId }),
      });
      const json = await res.json();
      if (json.success && json.data) {
        setGroupableProperties(json.data.groupableProperties ?? []);
        setCheckboxProperties(json.data.checkboxProperties ?? []);
        setRowProperties(json.data.rowProperties ?? []);
        setDateProperties(json.data.dateProperties ?? []);
        setTitleProperties(json.data.titleProperties ?? []);
        setSelectOptions(json.data.selectOptions ?? {});
        if (groupProperty) {
          setSettings((prev) => ({ ...prev, groupProperty }));
        }
      }
    } catch { /* silent */ }
  };

  // ── 플래너 연결 ─────────────────────────────────────────────────────────────

  // 이름 키워드로 속성 자동 매칭
  const pickProp = (names: string[], keywords: string[], fallback: string) =>
    names.find((n) => keywords.some((k) => n.toLowerCase().includes(k.toLowerCase()))) || fallback;

  // 같은(또는 별도) 토큰으로 플래너 후보 DB 목록 불러오기
  const handleLoadPlannerDatabases = async () => {
    const token = settings.plannerToken.trim() || settings.apiKey.trim();
    if (!token) { setErrorMsg("먼저 Notion API 토큰을 입력해주세요."); return; }
    setPlannerDbLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/databases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: token }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error?.message || "데이터베이스를 불러오는데 실패했습니다.");
      setPlannerDatabases(json.data ?? []);
      if (!json.data?.length) setErrorMsg("연결된 데이터베이스가 없습니다. Notion Integration을 플래너 DB에 연결해주세요.");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.");
    } finally {
      setPlannerDbLoading(false);
    }
  };

  // 플래너 DB 선택 → 속성 자동 감지(제목/날짜/책/연결 관계형) + 프젝칼 쪽 속성(상위 항목/책/완료)도 자동 채움
  const handleSelectPlannerDb = async (dbId: string) => {
    update("plannerDbId", dbId);
    if (!dbId) return;
    const token = settings.plannerToken.trim() || settings.apiKey.trim();
    try {
      const res = await fetch("/api/analyze-database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: token, databaseId: dbId }),
      });
      const json = await res.json();
      const data = json?.data;
      if (!json.success || !data) return;

      const plannerRelations: string[] = (data.groupableProperties ?? [])
        .filter((p: { type: string }) => p.type === "relation")
        .map((p: { name: string }) => p.name);

      // 프젝칼(메인 DB) 쪽 속성 — 이미 분석된 shared 상태에서 자동 매칭
      const mainRelations = groupableProperties.filter((p) => p.type === "relation").map((p) => p.name);
      const mainDoneCandidates = [
        ...groupableProperties.filter((p) => p.type === "rollup" || p.type === "formula").map((p) => p.name),
        ...checkboxProperties,
      ];

      setSettings((prev) => ({
        ...prev,
        plannerDbId: dbId,
        plannerTitleProp: data.titleProperty || prev.plannerTitleProp || "범위",
        plannerDateProp: data.dateProperty || prev.plannerDateProp || "날짜",
        plannerBookProp: pickProp(plannerRelations, ["책", "book", "도서"], prev.plannerBookProp || "책"),
        plannerLinkProp: pickProp(plannerRelations, ["planner", "프젝", "프로젝", "project", "캘린"], prev.plannerLinkProp || "PLANNER"),
        parentRelProp: pickProp(mainRelations, ["상위", "parent", "상위 항목"], prev.parentRelProp || "상위 항목"),
        bookProperty: pickProp(mainRelations, ["책", "book", "도서"], prev.bookProperty || "책"),
        doneProperty: prev.doneProperty.trim() || pickProp(mainDoneCandidates, ["완료", "done", "complete", "체크"], ""),
      }));
    } catch { /* silent — 사용자가 수동 보정 가능 */ }
  };

  // ── Google Calendar ───────────────────────────────────────────────────────

  const connectGCal = () => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      setErrorMsg("NEXT_PUBLIC_GOOGLE_CLIENT_ID 환경 변수가 설정되지 않았습니다. Vercel 대시보드를 확인해주세요.");
      return;
    }
    const redirectUri = `${window.location.origin}/gcal-callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      access_type: "offline",
      scope: "https://www.googleapis.com/auth/calendar",
      prompt: "consent",
    });
    const popup = window.open(
      `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      "gcal-auth",
      "width=500,height=600,left=200,top=100"
    );
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "gcal-token") {
        const { token, refreshToken } = event.data as { type: string; token: string; refreshToken?: string };
        setGcalToken(token);
        if (refreshToken) setGcalRefreshToken(refreshToken);
        loadGCalCalendars(token);
        window.removeEventListener("message", handleMessage);
        popup?.close();
      }
    };
    window.addEventListener("message", handleMessage);
  };

  const loadGCalCalendars = async (token: string, keepSelection?: Set<string>) => {
    setGcalLoading(true);
    try {
      const res = await fetch(`/api/gcal?token=${encodeURIComponent(token)}&action=list`);
      const data = await res.json();
      if (Array.isArray(data.items)) {
        setGcalCalendars(data.items);
        if (!keepSelection || keepSelection.size === 0) {
          setGcalSelectedIds(new Set(data.items.map((c: GCalCalendar) => c.id)));
        }
      }
    } catch (e) {
      console.error("GCal calendar list error:", e);
    } finally {
      setGcalLoading(false);
    }
  };

  const toggleGCalCalendar = (id: string) => {
    setGcalSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const disconnectGCal = () => {
    setGcalToken(null);
    setGcalRefreshToken(null);
    setGcalCalendars([]);
    setGcalSelectedIds(new Set());
  };

  // ── Generate URL ──────────────────────────────────────────────────────────

  const handleGenerate = async () => {
    setGenerating(true);
    setErrorMsg(null);
    try {
      const cfg: Record<string, unknown> = {
        token: settings.apiKey,
        dbId: settings.databaseId,
        dateProp: settings.dateProperty,
        titleProp: settings.titleProperty,
        ...(settings.groupProperty.trim() ? { groupProp: settings.groupProperty.trim() } : {}),
        ...(settings.groupOptionFilter.length > 0 ? { groupFilter: settings.groupOptionFilter } : {}),
        ...(settings.dependencyProperty.trim() ? { dependsProp: settings.dependencyProperty.trim() } : {}),
        ...(settings.highlightProperty.trim() ? { highlightProp: settings.highlightProperty.trim(), highlightBorderColor: settings.highlightBorderColor } : {}),
        ...(settings.rowProperty.trim() ? { rowProp: settings.rowProperty.trim() } : {}),
        ...(settings.doneProperty.trim() ? { doneProp: settings.doneProperty.trim() } : {}),
        ...(settings.plannerDbId.trim() ? {
          plannerDbId: settings.plannerDbId.trim(),
          ...(settings.plannerToken.trim() ? { plannerToken: settings.plannerToken.trim() } : {}),
          plannerTitleProp: settings.plannerTitleProp.trim() || "범위",
          plannerDateProp: settings.plannerDateProp.trim() || "날짜",
          plannerBookProp: settings.plannerBookProp.trim() || "책",
          plannerLinkProp: settings.plannerLinkProp.trim() || "PLANNER",
          parentRelProp: settings.parentRelProp.trim() || "상위 항목",
          bookProp: settings.bookProperty.trim() || "책",
        } : {}),
        primaryColor: settings.primaryColor,
        backgroundColor: settings.backgroundColor,
        backgroundOpacity: settings.backgroundOpacity,
        fontFamily: settings.fontFamily,
        barColors: settings.barColors,
        labelColor: settings.labelColor,
        multiRow: settings.multiRow,
        darkMode: settings.darkMode,
        weekView: settings.weekView,
      };
      if (gcalToken || gcalRefreshToken) {
        if (gcalToken) cfg.gcalToken = gcalToken;
        if (gcalRefreshToken) cfg.gcalRefreshToken = gcalRefreshToken;
        if (gcalSelectedIds.size > 0) cfg.gcalCalIds = [...gcalSelectedIds];
        if (gcalSyncTargetCalId) cfg.gcalSyncCalId = gcalSyncTargetCalId;
        if (gcalShowTimed) cfg.gcalShowTimed = true;
        if (Object.keys(gcalColorOverrides).length > 0) cfg.gcalCalColors = gcalColorOverrides;
        if (Object.keys(gcalBorderColorOverrides).length > 0) cfg.gcalBorderColors = gcalBorderColorOverrides;
      }
      if (Object.keys(groupColorOverrides).length > 0) cfg.groupColors = groupColorOverrides;
      const encoded = btoa(
        Array.from(new TextEncoder().encode(JSON.stringify(cfg)))
          .map((b) => String.fromCharCode(b))
          .join("")
      ).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
      setGeneratedUrl(`${window.location.origin}/u/${encoded}`);
      setStep(4);
    } catch (e) {
      console.error(e);
      setErrorMsg("설정 생성 중 오류가 발생했습니다.");
    } finally {
      setGenerating(false);
    }
  };

  const previewTheme = {
    primaryColor: settings.primaryColor,
    backgroundColor: settings.backgroundColor,
    backgroundOpacity: settings.backgroundOpacity,
    barColors: settings.barColors,
    labelColor: settings.labelColor,
    multiRow: settings.multiRow,
    darkMode: settings.darkMode,
    weekView: settings.weekView,
  };

  return (
    <>
      <style>{`
        @import url("https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css");
        @import url('https://cdn.jsdelivr.net/npm/galmuri@latest/dist/galmuri.css');

        body {
          margin: 0;
          padding-bottom: 120px;
          background-color: #FDF0F6;
          background-image:
            linear-gradient(rgba(232,168,192,0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(232,168,192,0.1) 1px, transparent 1px);
          background-size: 40px 40px;
          font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
          color: #4A4A4A;
        }

        .pixel-window {
          background: rgba(255,255,255,0.95);
          border: 1px solid #E8A8C0;
          border-radius: 16px;
          box-shadow: 0 20px 60px -10px rgba(232,168,192,0.25);
          max-width: 1100px;
          margin: 3rem auto;
          position: relative;
          backdrop-filter: blur(10px);
          overflow: hidden;
        }

        .title-bar {
          background: white;
          padding: 12px 20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid #FFE4E1;
          color: #E8A8C0;
          font-weight: 700;
          letter-spacing: 0.5px;
        }

        .window-content { padding: 40px; min-height: 500px; }

        .step-progress-bar { display: flex; margin-bottom: 40px; justify-content: center; gap: 12px; }

        .step-pill {
          padding: 8px 24px; border-radius: 50px; font-size: 13px; font-weight: 600;
          color: #bbb; background: #f8f8f8; transition: all 0.3s ease;
        }
        .step-pill.active { background: #FFF0F5; color: #E8A8C0; box-shadow: 0 4px 12px rgba(232,168,192,0.2); }
        .step-pill.completed { background: #E8A8C0; color: white; }

        .soft-input, .soft-select {
          width: 100%; padding: 16px; border: 1px solid #eee; border-radius: 12px;
          background: #F9F9F9; font-family: 'Pretendard', sans-serif; font-size: 16px;
          color: #444; outline: none; margin-bottom: 12px; transition: all 0.2s; box-sizing: border-box;
        }
        .soft-select {
          cursor: pointer; appearance: none;
          background-image: url("data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23444' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e");
          background-repeat: no-repeat; background-position: right 1rem center; background-size: 1em;
        }
        .soft-input:focus, .soft-select:focus {
          background: white; border-color: #E8A8C0; box-shadow: 0 0 0 4px rgba(232,168,192,0.1);
        }

        .soft-btn {
          background: #E8A8C0; color: white; border: none; padding: 14px 32px;
          font-family: 'Pretendard', sans-serif; font-weight: 600; border-radius: 12px;
          cursor: pointer; font-size: 15px; box-shadow: 0 4px 12px rgba(232,168,192,0.3);
          transition: all 0.2s; display: inline-flex; align-items: center; justify-content: center; gap: 8px;
        }
        .soft-btn:hover { transform: translateY(-2px); background: #E090A8; box-shadow: 0 6px 16px rgba(232,168,192,0.4); }
        .soft-btn:disabled { background: #F0D0D8; cursor: not-allowed; box-shadow: none; transform: none; }
        .soft-btn.secondary {
          background: white; color: #666; border: 1px solid #eee; box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }
        .soft-btn.secondary:hover { background: #f9f9f9; border-color: #ddd; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
        .soft-btn.gcal {
          background: #4285F4; box-shadow: 0 4px 12px rgba(66,133,244,0.3);
        }
        .soft-btn.gcal:hover { background: #3367D6; box-shadow: 0 6px 16px rgba(66,133,244,0.4); }

        .db-card {
          border: 1px solid #f0f0f0; border-radius: 16px; background: white; padding: 24px;
          cursor: pointer; transition: all 0.3s; display: flex; align-items: center; gap: 16px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.02);
        }
        .db-card:hover { border-color: #E8A8C0; transform: translateY(-4px); box-shadow: 0 10px 20px rgba(232,168,192,0.15); }
        .db-card.selected { border-color: #E8A8C0; background: #FFF5F8; box-shadow: 0 0 0 2px #E8A8C0; }

        .cal-card {
          border: 1px solid #f0f0f0; border-radius: 12px; background: white; padding: 14px 18px;
          cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 12px;
          box-shadow: 0 2px 6px rgba(0,0,0,0.02);
        }
        .cal-card:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(0,0,0,0.06); }
        .cal-card.selected { border-color: #4285F4; background: #F0F4FF; }

        .theme-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        .theme-item {
          border: 1px solid #f0f0f0; border-radius: 12px; background: white; padding: 12px;
          text-align: center; cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.02);
        }
        .theme-item:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
        .theme-item.selected { border-color: #E8A8C0; background: #FFF5F8; box-shadow: 0 0 0 2px #E8A8C0; }

        .color-dot {
          width: 16px; height: 16px; border-radius: 50%; border: 1px solid rgba(0,0,0,0.05);
          display: inline-block; margin: 0 -3px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);
        }

        .section-title {
          font-size: 16px; font-weight: 700; color: #333; margin-bottom: 16px;
          display: flex; align-items: center; gap: 8px;
        }

        .color-picker-wrapper {
          display: flex; align-items: center; justify-content: space-between; padding: 10px;
          background: #fff; border: 1px solid #f0f0f0; border-radius: 10px; margin-bottom: 8px;
        }
        .color-input-circle {
          width: 32px; height: 32px; padding: 0; border: none; border-radius: 50%;
          overflow: hidden; cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }

        .range-slider {
          width: 100%; height: 6px; border-radius: 5px; background: #eee; outline: none; -webkit-appearance: none;
        }
        .range-slider::-webkit-slider-thumb {
          -webkit-appearance: none; width: 20px; height: 20px; border-radius: 50%;
          background: #E8A8C0; cursor: pointer; box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        }

        .bar-colors-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; }
        .bar-color-item {
          display: flex; align-items: center; gap: 6px; padding: 6px 8px;
          background: #fff; border: 1px solid #f0f0f0; border-radius: 8px;
        }
        .bar-color-input {
          width: 24px; height: 24px; padding: 0; border: none; border-radius: 50%;
          overflow: hidden; cursor: pointer; box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .footer {
          position: fixed; bottom: 0; left: 0; right: 0; text-align: center; padding: 20px;
          color: #888; font-size: 13px; line-height: 1.8;
          background: rgba(253,240,246,0.8); backdrop-filter: blur(10px); z-index: 100;
        }
        .footer a { color: #E8A8C0; text-decoration: none; font-weight: 600; }
        .footer a:hover { color: #D88AA8; }

        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spin { 100% { transform: rotate(360deg); } }
      `}</style>

      <div className="pixel-window">
        <div className="title-bar">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Settings2 size={18} strokeWidth={2.5} />
            <span>Project Calendar</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#eee" }} />
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#eee" }} />
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#FF6B6B", cursor: "pointer" }} />
          </div>
        </div>

        <div className="window-content">
          <div className="step-progress-bar">
            <div className={`step-pill ${step > 1 ? "completed" : step === 1 ? "active" : ""}`}>01 Notion</div>
            <div className={`step-pill ${step > 2 ? "completed" : step === 2 ? "active" : ""}`}>02 Google</div>
            <div className={`step-pill ${step > 3 ? "completed" : step === 3 ? "active" : ""}`}>03 디자인</div>
            <div className={`step-pill ${step === 4 ? "active" : ""}`}>04 완료</div>
          </div>

          {errorMsg && (
            <div style={{ background: "#FFF0F0", border: "1px solid #FFCDD2", borderRadius: 12, padding: 16, marginBottom: 24, color: "#D32F2F", display: "flex", alignItems: "center", gap: 12, fontSize: 14 }}>
              <span style={{ fontSize: 18 }}>!</span> {errorMsg}
            </div>
          )}

          {/* Step 1: Notion */}
          {step === 1 && (
            <div style={{ animation: "fadeIn 0.5s" }}>
              <div style={{ textAlign: "center", marginBottom: 40 }}>
                <div style={{ width: 80, height: 80, background: "#FFF0F5", borderRadius: "50%", margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Settings2 size={40} color="#E8A8C0" />
                </div>
                <h2 style={{ fontSize: 24, marginBottom: 12, fontWeight: 700 }}>Notion 연결하기</h2>
                <p style={{ color: "#888", fontSize: 15 }}>Integration 토큰을 사용하여 데이터베이스를 불러옵니다.</p>
              </div>
              <div style={{ maxWidth: 450, margin: "0 auto 28px" }}>
                <label style={{ display: "block", marginBottom: 8, fontWeight: 600, fontSize: 13, color: "#888" }}>기존 위젯 URL로 설정 불러오기</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="soft-input" value={importUrl}
                    onChange={(e) => setImportUrl(e.target.value)}
                    placeholder="https://...projectcal.../u/..." style={{ marginBottom: 0, fontSize: 13 }} />
                  <button className="soft-btn secondary" onClick={handleImportUrl} disabled={!importUrl.trim()} style={{ whiteSpace: "nowrap", fontSize: 13, padding: "0 16px" }}>
                    불러오기
                  </button>
                </div>
                <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ flex: 1, height: 1, background: "#eee" }} />
                  <span style={{ fontSize: 12, color: "#bbb" }}>또는 직접 입력</span>
                  <div style={{ flex: 1, height: 1, background: "#eee" }} />
                </div>
              </div>

              <div style={{ maxWidth: 450, margin: "0 auto" }}>
                <label style={{ display: "block", marginBottom: 10, fontWeight: 600, fontSize: 14, color: "#555" }}>API TOKEN</label>
                <div style={{ display: "flex", gap: 10 }}>
                  <input type="password" className="soft-input" value={settings.apiKey}
                    onChange={(e) => { update("apiKey", e.target.value); setDatabases([]); }}
                    placeholder="secret_..." style={{ marginBottom: 0 }} />
                  <button className="soft-btn secondary" onClick={handleLoadDatabases} disabled={loading} style={{ whiteSpace: "nowrap" }}>
                    {loading ? "로딩..." : "목록 불러오기"}
                  </button>
                </div>
              </div>
              {databases.length > 0 && (
                <div style={{ marginTop: 40, animation: "fadeIn 0.5s" }}>
                  <h3 style={{ textAlign: "center", fontSize: 16, marginBottom: 20, color: "#555" }}>데이터베이스 선택</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 20 }}>
                    {databases.map((db) => (
                      <div key={db.id} className={`db-card${settings.databaseId === db.id ? " selected" : ""}`} onClick={() => handleSelectDatabase(db.id, db.title)}>
                        <div style={{ width: 48, height: 48, borderRadius: 12, background: "#FFF0F5", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <CalendarDays size={24} color="#E8A8C0" />
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 15, color: "#333", marginBottom: 4 }}>{db.title}</div>
                          <div style={{ fontSize: 12, color: "#999" }}>ID: {db.id.slice(0, 8)}...</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {settings.databaseId && !loading && (
                    <div style={{ marginTop: 28, display: "flex", justifyContent: "center", animation: "fadeIn 0.4s" }}>
                      <button className="soft-btn" onClick={() => setStep(2)} style={{ padding: "14px 48px" }}>
                        다음: Google Calendar →
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 2: Google Calendar */}
          {step === 2 && (
            <div style={{ animation: "fadeIn 0.5s" }}>
              <div style={{ textAlign: "center", marginBottom: 40 }}>
                <div style={{ width: 80, height: 80, background: "#EEF2FF", borderRadius: "50%", margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40 }}>
                  🗓
                </div>
                <h2 style={{ fontSize: 24, marginBottom: 12, fontWeight: 700 }}>Google Calendar 연결</h2>
                <p style={{ color: "#888", fontSize: 15 }}>Google Calendar 일정을 함께 표시하고, Notion 일정을 GCal에 추가할 수 있습니다.</p>
                <p style={{ color: "#bbb", fontSize: 13, marginTop: 6 }}>선택 사항입니다. 건너뛸 수 있어요.</p>
              </div>

              {!gcalToken ? (
                <div style={{ textAlign: "center" }}>
                  <button className="soft-btn gcal" onClick={connectGCal} style={{ fontSize: 16, padding: "16px 48px" }}>
                    🔗 Google Calendar 연결하기
                  </button>
                  {!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
                    <p style={{ marginTop: 16, color: "#e53e3e", fontSize: 13 }}>
                      ⚠ NEXT_PUBLIC_GOOGLE_CLIENT_ID 환경 변수가 설정되지 않았습니다.
                    </p>
                  )}
                </div>
              ) : (
                <div style={{ maxWidth: 600, margin: "0 auto", animation: "fadeIn 0.4s" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#34A853" }} />
                      <span style={{ fontWeight: 700, color: "#333", fontSize: 15 }}>연결됨</span>
                    </div>
                    <button className="soft-btn secondary" onClick={disconnectGCal} style={{ padding: "8px 16px", fontSize: 13 }}>
                      연결 해제
                    </button>
                  </div>

                  {gcalLoading ? (
                    <div style={{ textAlign: "center", padding: 40, color: "#888" }}>
                      <span style={{ display: "inline-block", animation: "spin 1s linear infinite", fontSize: 24 }}>↻</span>
                      <p style={{ marginTop: 12 }}>캘린더 목록 불러오는 중...</p>
                    </div>
                  ) : (
                    <>
                      <p style={{ fontSize: 13, color: "#666", marginBottom: 16, textAlign: "center" }}>
                        위젯에 표시할 캘린더를 선택하세요. ({gcalSelectedIds.size}/{gcalCalendars.length}개 선택됨)
                      </p>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 10 }}>
                        {gcalCalendars.map((cal) => {
                          const isSelected = gcalSelectedIds.has(cal.id);
                          const color = gcalColorOverrides[cal.id] || cal.backgroundColor || "#4285F4";
                          return (
                            <div
                              key={cal.id}
                              className={`cal-card${isSelected ? " selected" : ""}`}
                              onClick={() => toggleGCalCalendar(cal.id)}
                            >
                              {/* Fill color picker */}
                              <input
                                type="color"
                                value={color}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  setGcalColorOverrides((prev) => ({ ...prev, [cal.id]: e.target.value }));
                                }}
                                style={{ width: 18, height: 18, padding: 0, border: "none", borderRadius: "50%", cursor: "pointer", flexShrink: 0, opacity: isSelected ? 1 : 0.4 }}
                              />
                              {/* Border color picker */}
                              <input
                                type="color"
                                title="테두리 색"
                                value={gcalBorderColorOverrides[cal.id] || "#ffffff"}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  setGcalBorderColorOverrides((prev) => ({ ...prev, [cal.id]: e.target.value }));
                                }}
                                style={{ width: 18, height: 18, padding: 0, border: "1px dashed #aaa", borderRadius: "50%", cursor: "pointer", flexShrink: 0, opacity: isSelected ? 1 : 0.4 }}
                              />
                              <div style={{ flex: 1, overflow: "hidden" }}>
                                <div style={{ fontWeight: 600, fontSize: 13, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {cal.summary}
                                  {cal.primary && <span style={{ marginLeft: 6, fontSize: 10, color: "#999", fontWeight: 400 }}>기본</span>}
                                </div>
                              </div>
                              <div style={{
                                width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                                border: `2px solid ${isSelected ? color : "#ddd"}`,
                                background: isSelected ? color : "transparent",
                                display: "flex", alignItems: "center", justifyContent: "center",
                              }}>
                                {isSelected && <span style={{ color: "white", fontSize: 11, lineHeight: 1 }}>✓</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    {/* Sync target calendar */}
                      {gcalCalendars.length > 0 && (
                        <div style={{ marginTop: 20 }}>
                          <label style={{ fontSize: 13, fontWeight: 600, color: "#555", display: "block", marginBottom: 8 }}>
                            Notion 일정을 GCal에 추가할 때 사용할 캘린더
                          </label>
                          <select
                            className="soft-select"
                            value={gcalSyncTargetCalId}
                            onChange={(e) => setGcalSyncTargetCalId(e.target.value)}
                            style={{ marginBottom: 0, fontSize: 13 }}
                          >
                            <option value="">— 기본 캘린더 —</option>
                            {gcalCalendars.map((cal) => (
                              <option key={cal.id} value={cal.id}>
                                {cal.summary}{cal.primary ? " (기본)" : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* Timed events toggle */}
                      <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 10 }}>
                        <label
                          onClick={() => setGcalShowTimed((p) => !p)}
                          style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}
                        >
                          <div style={{
                            width: 36, height: 20, borderRadius: 10, flexShrink: 0, position: "relative",
                            background: gcalShowTimed ? "#4285F4" : "#ccc", transition: "background 0.2s",
                          }}>
                            <div style={{
                              position: "absolute", top: 3, left: gcalShowTimed ? 18 : 3,
                              width: 14, height: 14, borderRadius: "50%", background: "white",
                              transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                            }} />
                          </div>
                          <span style={{ fontSize: 13, color: "#555", fontWeight: 600 }}>시간 지정 일정도 표시</span>
                        </label>
                      </div>
                    </>
                  )}
                </div>
              )}

              <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 40 }}>
                <button className="soft-btn secondary" onClick={() => setStep(1)} style={{ padding: "14px 28px" }}>이전</button>
                <button className="soft-btn secondary" onClick={() => setStep(3)} style={{ padding: "14px 28px" }}>
                  건너뛰기
                </button>
                <button className="soft-btn" onClick={() => setStep(3)} style={{ padding: "14px 48px" }}>
                  다음: 디자인 설정 →
                </button>
              </div>
            </div>
          )}

          {/* Step 3: 속성 설정 + 디자인 */}
          {step === 3 && (
            <div style={{ animation: "fadeIn 0.5s", display: "flex", flexDirection: "column", gap: 28, alignItems: "center" }}>

              {/* 속성 설정 */}
              <div style={{ width: "100%", background: "#FFF8FB", border: "1px solid #F0D0DA", borderRadius: 16, padding: "20px 24px" }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 16, color: "#555", display: "flex", alignItems: "center", gap: 8 }}>
                  <CalendarDays size={15} color="#E8A8C0" /> {selectedDbName} — 속성 설정
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, color: "#888", fontWeight: 600, display: "block", marginBottom: 6 }}>날짜 속성</label>
                    {dateProperties.length > 0 ? (
                      <select className="soft-select" value={settings.dateProperty}
                        onChange={(e) => update("dateProperty", e.target.value)}
                        style={{ marginBottom: 0, fontSize: 13 }}>
                        {dateProperties.map((name) => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    ) : (
                      <input className="soft-input" value={settings.dateProperty}
                        onChange={(e) => update("dateProperty", e.target.value)}
                        style={{ marginBottom: 0, fontSize: 13 }} />
                    )}
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "#888", fontWeight: 600, display: "block", marginBottom: 6 }}>제목 속성</label>
                    {titleProperties.length > 0 ? (
                      <select className="soft-select" value={settings.titleProperty}
                        onChange={(e) => update("titleProperty", e.target.value)}
                        style={{ marginBottom: 0, fontSize: 13 }}>
                        {titleProperties.map((p) => (
                          <option key={p.name} value={p.name}>{p.name}{p.type !== "title" ? ` (${p.type})` : ""}</option>
                        ))}
                      </select>
                    ) : (
                      <input className="soft-input" value={settings.titleProperty}
                        onChange={(e) => update("titleProperty", e.target.value)}
                        style={{ marginBottom: 0, fontSize: 13 }} />
                    )}
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "#888", fontWeight: 600, display: "block", marginBottom: 6 }}>
                      그룹 속성 <span style={{ fontWeight: 400, color: "#bbb" }}>(선택)</span>
                    </label>
                    {groupableProperties.length > 0 ? (
                      <select className="soft-select" value={settings.groupProperty}
                        onChange={(e) => update("groupProperty", e.target.value)}
                        style={{ marginBottom: 0, fontSize: 13 }}>
                        <option value="">— 없음 —</option>
                        {groupableProperties.map((p) => {
                          const hasOpts = p.type === "select" || p.type === "multi_select";
                          return (
                            <option key={p.name} value={p.name}>
                              🎨 {p.name} ({p.type})
                            </option>
                          );
                        })}
                      </select>
                    ) : (
                      <input className="soft-input" value={settings.groupProperty}
                        onChange={(e) => update("groupProperty", e.target.value)}
                        placeholder="예: 팀, 카테고리"
                        style={{ marginBottom: 0, fontSize: 13 }} />
                    )}
                    {settings.groupProperty && !selectOptions[settings.groupProperty] && (
                      <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>
                        선택 후 팔레트에서 값별 색상 지정 가능
                      </div>
                    )}
                  </div>
                </div>
                {/* 그룹(분류) 팝업에 표시할 항목 선택/필터 */}
                {settings.groupProperty && (selectOptions[settings.groupProperty]?.length ?? 0) > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <label style={{ fontSize: 12, color: "#888", fontWeight: 600, display: "block", marginBottom: 6 }}>
                      🏷 팝업에 표시할 분류 <span style={{ fontWeight: 400, color: "#bbb" }}>(미선택 시 전체 표시)</span>
                    </label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {selectOptions[settings.groupProperty].map((opt) => {
                        const on = settings.groupOptionFilter.includes(opt);
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => update("groupOptionFilter", on
                              ? settings.groupOptionFilter.filter((o) => o !== opt)
                              : [...settings.groupOptionFilter, opt])}
                            style={{
                              padding: "5px 10px", fontSize: 12, borderRadius: 16, cursor: "pointer",
                              border: `1px solid ${on ? "#E8A8C0" : "#e5e5e7"}`,
                              background: on ? "#FFF0F5" : "#fff", color: on ? "#D88AA8" : "#888",
                              fontWeight: on ? 700 : 400,
                            }}
                          >
                            {on ? "✓ " : ""}{opt || "(빈 값)"}
                          </button>
                        );
                      })}
                    </div>
                    {settings.groupOptionFilter.length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 11, color: "#999", marginBottom: 4 }}>표시 순서 (위 = 먼저)</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          {settings.groupOptionFilter.map((opt, i) => {
                            const move = (delta: number) => {
                              const arr = [...settings.groupOptionFilter];
                              const j = i + delta;
                              if (j < 0 || j >= arr.length) return;
                              [arr[i], arr[j]] = [arr[j], arr[i]];
                              update("groupOptionFilter", arr);
                            };
                            return (
                              <div key={opt} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, background: "#fff", border: "1px solid #eee", borderRadius: 8, padding: "4px 8px" }}>
                                <span style={{ color: "#bbb", width: 16, textAlign: "center" }}>{i + 1}</span>
                                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#555" }}>{opt || "(빈 값)"}</span>
                                <button type="button" onClick={() => move(-1)} disabled={i === 0}
                                  style={{ border: "none", background: "none", cursor: i === 0 ? "default" : "pointer", color: i === 0 ? "#ddd" : "#888", fontSize: 13 }}>↑</button>
                                <button type="button" onClick={() => move(1)} disabled={i === settings.groupOptionFilter.length - 1}
                                  style={{ border: "none", background: "none", cursor: i === settings.groupOptionFilter.length - 1 ? "default" : "pointer", color: i === settings.groupOptionFilter.length - 1 ? "#ddd" : "#888", fontSize: 13 }}>↓</button>
                              </div>
                            );
                          })}
                        </div>
                        <button type="button" onClick={() => update("groupOptionFilter", [])}
                          style={{ marginTop: 8, fontSize: 11, color: "#aaa", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                          전체 표시로 초기화
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {/* 의존성(선행 작업) 속성 — Notion 관계형 연결을 선으로 표시 */}
                {(() => {
                  const relationProps = groupableProperties.filter((p) => p.type === "relation");
                  return (
                    <div style={{ marginTop: 12 }}>
                      <label style={{ fontSize: 12, color: "#888", fontWeight: 600, display: "block", marginBottom: 6 }}>
                        🔗 선행 작업(의존성) 속성 <span style={{ fontWeight: 400, color: "#bbb" }}>(선택)</span>
                      </label>
                      {relationProps.length > 0 ? (
                        <select className="soft-select" value={settings.dependencyProperty}
                          onChange={(e) => update("dependencyProperty", e.target.value)}
                          style={{ marginBottom: 0, fontSize: 13 }}>
                          <option value="">— 없음 —</option>
                          {relationProps.map((p) => (
                            <option key={p.name} value={p.name}>{p.name} (relation)</option>
                          ))}
                        </select>
                      ) : (
                        <input className="soft-input" value={settings.dependencyProperty}
                          onChange={(e) => update("dependencyProperty", e.target.value)}
                          placeholder="예: 선행 작업"
                          style={{ marginBottom: 0, fontSize: 13 }} />
                      )}
                      <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>
                        비워두면 노션의 &quot;선행 작업&quot; 관계형을 자동 인식합니다. 선행 → 후속이 선으로 연결되고, 연결된 항목은 같은 줄에 붙여 배치됩니다
                      </div>
                    </div>
                  );
                })()}

                {/* 강조(테두리) 속성 + 행 위치 속성 */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, color: "#888", fontWeight: 600, display: "block", marginBottom: 6 }}>
                      ⭐ 강조(테두리) 속성 <span style={{ fontWeight: 400, color: "#bbb" }}>(체크박스, 선택)</span>
                    </label>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {checkboxProperties.length > 0 ? (
                        <select className="soft-select" value={settings.highlightProperty}
                          onChange={(e) => update("highlightProperty", e.target.value)}
                          style={{ marginBottom: 0, fontSize: 13, flex: 1 }}>
                          <option value="">— 없음 —</option>
                          {checkboxProperties.map((name) => (
                            <option key={name} value={name}>{name}</option>
                          ))}
                        </select>
                      ) : (
                        <input className="soft-input" value={settings.highlightProperty}
                          onChange={(e) => update("highlightProperty", e.target.value)}
                          placeholder="예: 중요"
                          style={{ marginBottom: 0, fontSize: 13, flex: 1 }} />
                      )}
                      <input type="color" value={settings.highlightBorderColor}
                        onChange={(e) => update("highlightBorderColor", e.target.value)}
                        title="테두리 색"
                        style={{ width: 30, height: 30, padding: 0, border: "1px solid #ddd", borderRadius: 6, cursor: "pointer", flexShrink: 0 }} />
                    </div>
                    <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>
                      체크된 항목에 테두리를 표시합니다
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "#888", fontWeight: 600, display: "block", marginBottom: 6 }}>
                      ↕ 행 위치 속성 <span style={{ fontWeight: 400, color: "#bbb" }}>(선택)</span>
                    </label>
                    {rowProperties.length > 0 ? (
                      <select className="soft-select" value={settings.rowProperty}
                        onChange={(e) => update("rowProperty", e.target.value)}
                        style={{ marginBottom: 0, fontSize: 13 }}>
                        <option value="">— 없음 —</option>
                        {rowProperties.map((p) => (
                          <option key={p.name} value={p.name}>{p.name} ({p.type})</option>
                        ))}
                      </select>
                    ) : (
                      <input className="soft-input" value={settings.rowProperty}
                        onChange={(e) => update("rowProperty", e.target.value)}
                        placeholder="예: 행위치"
                        style={{ marginBottom: 0, fontSize: 13 }} />
                    )}
                    <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>
                      줄 위치를 이 속성에 저장하고 다음에 그대로 불러옵니다
                    </div>
                  </div>
                </div>
              </div>

              {/* 플래너 연결 — 프젝칼 항목을 플래너로 "보내기" */}
              <div style={{ width: "100%", background: "#F4F9FF", border: "1px solid #CFE2F5", borderRadius: 16, padding: "20px 24px" }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, color: "#3A6EA5", display: "flex", alignItems: "center", gap: 8 }}>
                  📤 플래너 연결 <span style={{ fontWeight: 400, color: "#9bb8d6" }}>(선택)</span>
                </h3>
                <div style={{ fontSize: 12, color: "#88a", marginBottom: 16 }}>
                  설정하면 달력 항목을 클릭해 플래너로 보낼 수 있습니다. 제목·날짜·책을 복사하고 관계형으로 연결됩니다.
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "#888", fontWeight: 600, display: "block", marginBottom: 6 }}>
                    플래너 토큰 <span style={{ fontWeight: 400, color: "#bbb" }}>(비우면 위 토큰 공유)</span>
                  </label>
                  <input type="password" className="soft-input" value={settings.plannerToken}
                    onChange={(e) => { update("plannerToken", e.target.value); setPlannerDatabases([]); }}
                    placeholder="secret_... (선택)"
                    style={{ marginBottom: 12, fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "#888", fontWeight: 600, display: "block", marginBottom: 6 }}>플래너 데이터베이스</label>
                  <div style={{ display: "flex", gap: 8 }}>
                    {plannerDatabases.length > 0 ? (
                      <select className="soft-select" value={settings.plannerDbId}
                        onChange={(e) => handleSelectPlannerDb(e.target.value)}
                        style={{ marginBottom: 0, fontSize: 13, flex: 1 }}>
                        <option value="">— 선택 —</option>
                        {plannerDatabases.map((db) => (
                          <option key={db.id} value={db.id}>{db.title}</option>
                        ))}
                      </select>
                    ) : (
                      <input className="soft-input" value={settings.plannerDbId}
                        onChange={(e) => update("plannerDbId", e.target.value)}
                        placeholder="목록 불러오기 또는 DB ID 직접 입력"
                        style={{ marginBottom: 0, fontSize: 13, flex: 1 }} />
                    )}
                    <button className="soft-btn secondary" onClick={handleLoadPlannerDatabases} disabled={plannerDbLoading}
                      style={{ whiteSpace: "nowrap", fontSize: 13, padding: "0 16px" }}>
                      {plannerDbLoading ? "로딩..." : "목록 불러오기"}
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>
                    같은 토큰으로 연결된 DB를 불러옵니다. 선택하면 속성(제목·날짜·책·연결·완료)을 자동 감지합니다
                  </div>
                </div>
                <div style={{ marginTop: 12 }}>
                  <label style={{ fontSize: 12, color: "#888", fontWeight: 600, display: "block", marginBottom: 6 }}>
                    ✔ 완료(줄긋기) 속성 <span style={{ fontWeight: 400, color: "#bbb" }}>(프젝칼의 롤업/수식/체크박스, 선택)</span>
                  </label>
                  <input className="soft-input" value={settings.doneProperty}
                    onChange={(e) => update("doneProperty", e.target.value)}
                    placeholder="예: 완료"
                    style={{ marginBottom: 0, fontSize: 13 }} />
                  <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>
                    연결된 플래너 항목이 모두 완료되면 이 속성을 읽어 항목에 줄긋기를 표시합니다
                  </div>
                </div>
                {settings.plannerDbId.trim() && (
                  <details style={{ marginTop: 14 }}>
                    <summary style={{ fontSize: 12, color: "#3A6EA5", cursor: "pointer", fontWeight: 600 }}>속성 이름 (기본값 사용 권장)</summary>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 10 }}>
                      {([
                        ["plannerTitleProp", "플래너 제목"],
                        ["plannerDateProp", "플래너 날짜"],
                        ["plannerBookProp", "플래너 책"],
                        ["plannerLinkProp", "플래너→프젝칼 관계형"],
                        ["parentRelProp", "프젝칼 상위 항목 관계형"],
                        ["bookProperty", "프젝칼 책 관계형"],
                      ] as [keyof Settings, string][]).map(([key, label]) => (
                        <div key={key}>
                          <label style={{ fontSize: 11, color: "#999", display: "block", marginBottom: 4 }}>{label}</label>
                          <input className="soft-input" value={settings[key] as string}
                            onChange={(e) => update(key, e.target.value as never)}
                            style={{ marginBottom: 0, fontSize: 12, padding: 10 }} />
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>

              {/* 라이브 프리뷰 */}
              <div style={{ background: "#F7F8FA", padding: "24px 20px", borderRadius: 20, border: "1px solid #eee", width: "100%" }}>
                <div style={{ textAlign: "center", marginBottom: 16, fontSize: 14, color: "#888", fontWeight: 600 }}>LIVE PREVIEW</div>
                <div style={{ background: settings.darkMode ? "#191919" : "white", borderRadius: 8, overflow: "auto", boxShadow: "0 4px 12px rgba(0,0,0,0.05)", display: "flex", justifyContent: "center" }}>
                  <div style={{ padding: 10 }}>
                    <CalendarWidget configId="preview" theme={previewTheme} fontFamily={settings.fontFamily} previewProjects={makePreviewProjects(settings.multiRow, !!settings.dependencyProperty.trim())} />
                  </div>
                </div>
              </div>

              {/* 디자인 설정 */}
              <div style={{ width: "100%" }}>
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 28, marginBottom: 28 }}>
                  <div style={{ background: "#F9F9F9", padding: "16px 18px", borderRadius: 16, minWidth: 140 }}>
                    <div className="section-title" style={{ fontSize: 13, marginBottom: 12 }}><Type size={16} /> 폰트</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {[{ value: "Pretendard", label: "Pretendard" }, { value: "Corbel", label: "Corbel" }, { value: "Galmuri11", label: "갈무리11" }].map((f) => (
                        <label key={f.value} onClick={() => update("fontFamily", f.value)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, color: settings.fontFamily === f.value ? "#333" : "#999", fontWeight: settings.fontFamily === f.value ? 600 : 400 }}>
                          <div style={{ width: 18, height: 18, borderRadius: "50%", border: settings.fontFamily === f.value ? "2px solid #E8A8C0" : "2px solid #ddd", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            {settings.fontFamily === f.value && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#E8A8C0" }} />}
                          </div>
                          {f.label}
                        </label>
                      ))}
                    </div>
                    <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #eee" }}>
                      <label onClick={() => update("multiRow", !settings.multiRow)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, color: settings.multiRow ? "#333" : "#999", fontWeight: settings.multiRow ? 600 : 400 }}>
                        <div style={{ width: 18, height: 18, borderRadius: 4, border: settings.multiRow ? "2px solid #E8A8C0" : "2px solid #ddd", display: "flex", alignItems: "center", justifyContent: "center", background: settings.multiRow ? "#E8A8C0" : "transparent", flexShrink: 0 }}>
                          {settings.multiRow && <span style={{ color: "white", fontSize: 11, lineHeight: 1 }}>✓</span>}
                        </div>
                        겹침 2단
                      </label>
                    </div>
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #eee" }}>
                      <label onClick={() => update("darkMode", !settings.darkMode)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, color: settings.darkMode ? "#333" : "#999", fontWeight: settings.darkMode ? 600 : 400 }}>
                        <div style={{ width: 18, height: 18, borderRadius: 4, border: settings.darkMode ? "2px solid #E8A8C0" : "2px solid #ddd", display: "flex", alignItems: "center", justifyContent: "center", background: settings.darkMode ? "#E8A8C0" : "transparent", flexShrink: 0 }}>
                          {settings.darkMode && <span style={{ color: "white", fontSize: 11, lineHeight: 1 }}>✓</span>}
                        </div>
                        다크모드
                      </label>
                    </div>
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #eee" }}>
                      <label onClick={() => update("weekView", !settings.weekView)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, color: settings.weekView ? "#333" : "#999", fontWeight: settings.weekView ? 600 : 400 }}>
                        <div style={{ width: 18, height: 18, borderRadius: 4, border: settings.weekView ? "2px solid #E8A8C0" : "2px solid #ddd", display: "flex", alignItems: "center", justifyContent: "center", background: settings.weekView ? "#E8A8C0" : "transparent", flexShrink: 0 }}>
                          {settings.weekView && <span style={{ color: "white", fontSize: 11, lineHeight: 1 }}>✓</span>}
                        </div>
                        주별 보기
                      </label>
                    </div>
                  </div>
                  <div>
                    <div className="section-title" style={{ fontSize: 13, marginBottom: 12 }}><Palette size={16} /> 테마 선택</div>
                    <div className="theme-grid">
                      {THEMES.map((t) => (
                        <div key={t.name} className={`theme-item ${selectedTheme === t.name ? "selected" : ""}`}
                          onClick={() => { setSelectedTheme(t.name); setSettings((prev) => ({ ...prev, backgroundColor: t.colors.background, primaryColor: t.colors.primary, barColors: [...t.colors.barColors] })); }}>
                          <div style={{ display: "flex", justifyContent: "center", marginBottom: 8, paddingLeft: 8 }}>
                            <div className="color-dot" style={{ background: t.colors.background }} />
                            <div className="color-dot" style={{ background: t.colors.primary }} />
                            {t.colors.barColors.slice(0, 3).map((c, i) => <div key={i} className="color-dot" style={{ background: c }} />)}
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "#555" }}>{t.name}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ background: "#F9F9F9", padding: "16px 18px", borderRadius: 16, width: 180 }}>
                    <div className="section-title" style={{ fontSize: 13, marginBottom: 12 }}>색상</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                      {[{ label: "기본", key: "primaryColor" as const }, { label: "배경", key: "backgroundColor" as const }, { label: "글자", key: "labelColor" as const }].map(({ label, key }) => (
                        <div key={key}>
                          <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{label}</div>
                          <div className="color-picker-wrapper" style={{ padding: "6px 8px" }}>
                            <span style={{ fontSize: 11, color: "#555" }}>{settings[key]}</span>
                            <input type="color" className="color-input-circle" value={settings[key] as string} style={{ width: 24, height: 24 }}
                              onChange={(e) => { update(key, e.target.value); if (key !== "labelColor") setSelectedTheme(""); }} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 11, color: "#666" }}>투명도</span>
                        <span style={{ fontSize: 11, fontWeight: "bold", color: "#E8A8C0" }}>{settings.backgroundOpacity}%</span>
                      </div>
                      <input type="range" min={0} max={100} value={settings.backgroundOpacity} className="range-slider"
                        onChange={(e) => update("backgroundOpacity", parseInt(e.target.value))} />
                    </div>
                  </div>
                </div>
                <div style={{ background: "#F0F4F8", padding: "16px 20px", borderRadius: 16, marginBottom: 28 }}>
                  {(() => {
                    const groupOpts = settings.groupProperty ? (selectOptions[settings.groupProperty] ?? []) : [];
                    const hasGroupOpts = groupOpts.length > 0;
                    return (
                      <>
                        <div className="section-title" style={{ fontSize: 13, marginBottom: hasGroupOpts ? 12 : 4 }}>
                          프로젝트 바 색상 팔레트
                          {hasGroupOpts && (
                            <span style={{ fontSize: 11, fontWeight: 400, color: "#999", marginLeft: 6 }}>
                              ({settings.groupProperty})
                            </span>
                          )}
                        </div>
                        {!hasGroupOpts && settings.groupProperty && (
                          <div style={{ fontSize: 11, color: "#aaa", marginBottom: 10 }}>
                            그룹 속성이 select/multi_select 타입이 아니어서 번호로 표시됩니다.
                          </div>
                        )}
                        {!settings.groupProperty && groupableProperties.length > 0 && (
                          <div style={{ fontSize: 11, color: "#aaa", marginBottom: 10 }}>
                            그룹 속성을 선택하면 값별 색상을 지정할 수 있습니다.
                          </div>
                        )}
                        <div className="bar-colors-grid">
                          {hasGroupOpts ? (
                            <>
                              {groupOpts.map((optName, i) => {
                                const fallback = DEFAULT_BAR_COLORS[i % DEFAULT_BAR_COLORS.length];
                                const color = groupColorOverrides[optName] || settings.barColors[i] || fallback;
                                return (
                                  <div key={optName} className="bar-color-item">
                                    <input type="color" className="bar-color-input" value={color}
                                      onChange={(e) => {
                                        const next = [...settings.barColors];
                                        while (next.length <= i) next.push(DEFAULT_BAR_COLORS[next.length % DEFAULT_BAR_COLORS.length]);
                                        next[i] = e.target.value;
                                        update("barColors", next);
                                        setGroupColorOverrides((prev) => ({ ...prev, [optName]: e.target.value }));
                                        setSelectedTheme("");
                                      }} />
                                    <span style={{ fontSize: 10, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={optName}>{optName}</span>
                                  </div>
                                );
                              })}
                              <div className="bar-color-item" style={{ opacity: 0.6 }}>
                                <input type="color" className="bar-color-input"
                                  value={groupColorOverrides["__none__"] || DEFAULT_BAR_COLORS[groupOpts.length % DEFAULT_BAR_COLORS.length]}
                                  onChange={(e) => {
                                    setGroupColorOverrides((prev) => ({ ...prev, ["__none__"]: e.target.value }));
                                    setSelectedTheme("");
                                  }} />
                                <span style={{ fontSize: 10, color: "#aaa", fontStyle: "italic" }}>(없음)</span>
                              </div>
                            </>
                          ) : (
                            settings.barColors.map((color, i) => (
                              <div key={i} className="bar-color-item">
                                <input type="color" className="bar-color-input" value={color}
                                  onChange={(e) => { const next = [...settings.barColors]; next[i] = e.target.value; update("barColors", next); setSelectedTheme(""); }} />
                                <span style={{ fontSize: 10, color: "#888" }}>#{i + 1}</span>
                              </div>
                            ))
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, justifyContent: "center", width: "100%", maxWidth: 560, paddingBottom: 60 }}>
                <button className="soft-btn secondary" onClick={() => setStep(2)} style={{ padding: "14px 28px" }}>이전</button>
                <button className="soft-btn" onClick={handleGenerate} disabled={generating} style={{ flex: 1 }}>
                  {generating ? "생성 중..." : "완료 및 생성"}
                </button>
              </div>
            </div>
          )}

          {generating && (
            <div style={{ textAlign: "center", padding: "60px 0", animation: "fadeIn 0.5s" }}>
              <div style={{ fontSize: 50, marginBottom: 30, display: "inline-block", animation: "spin 2s linear infinite" }}>💿</div>
              <h3 style={{ fontSize: 24, fontWeight: 700, marginBottom: 10 }}>위젯을 굽고 있습니다...</h3>
              <p style={{ color: "#888", fontSize: 15 }}>잠시만 기다려주세요.</p>
            </div>
          )}

          {step === 4 && (
            <div style={{ textAlign: "center", animation: "fadeIn 0.5s", padding: "40px 0" }}>
              <div style={{ width: 80, height: 80, background: "#E8F5E9", borderRadius: "50%", margin: "0 auto 24px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 40 }}>🎉</div>
              <h2 style={{ fontSize: 28, fontWeight: 700, marginBottom: 12, color: "#333" }}>설치가 완료되었습니다!</h2>
              {gcalToken && gcalSelectedIds.size > 0 && (
                <p style={{ marginBottom: 16, color: "#4285F4", fontSize: 14, fontWeight: 600 }}>
                  🗓 Google Calendar {gcalSelectedIds.size}개 캘린더가 연결됩니다.
                </p>
              )}
              <p style={{ marginBottom: 40, color: "#666", fontSize: 16 }}>아래 링크를 노션에 &apos;임베드&apos;하여 사용하세요.</p>
              <div style={{ background: "#F9F9F9", border: "1px solid #eee", borderRadius: 12, padding: 20, maxWidth: 500, margin: "0 auto 30px" }}>
                <div style={{ fontSize: 13, color: "#888", marginBottom: 8, textAlign: "left", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                  <Settings2 size={14} /> 프로젝트 캘린더 URL
                </div>
                <div style={{ display: "flex", gap: 10 }}>
                  <input className="soft-input" readOnly value={generatedUrl} style={{ marginBottom: 0, fontSize: 14, background: "white" }} />
                  <button className="soft-btn" onClick={() => { navigator.clipboard.writeText(generatedUrl); alert("복사되었습니다!"); }} style={{ padding: "0 20px" }}>
                    <Copy size={16} />
                  </button>
                </div>
              </div>
              {gcalToken && (
                <p style={{ fontSize: 13, color: "#888", marginBottom: 24 }}>
                  ※ 위젯에서 Google Calendar 버튼을 클릭해 로그인하면 선택한 캘린더가 자동으로 표시됩니다.
                </p>
              )}
              <div style={{ display: "flex", gap: 16, justifyContent: "center" }}>
                <button className="soft-btn" onClick={() => window.open(generatedUrl, "_blank")}>
                  <Monitor size={16} /> 캘린더 확인
                </button>
                <button className="soft-btn secondary" onClick={() => setStep(3)}>
                  <Palette size={16} /> 디자인 수정하기
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="footer">
        Project Calendar<br />
        <a href="https://github.com" target="_blank" rel="noopener noreferrer">GitHub</a>
      </div>
    </>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingPageInner />
    </Suspense>
  );
}
