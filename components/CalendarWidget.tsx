"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { ChevronLeft, ChevronRight, Link } from "lucide-react";
import {
  Project,
  ProjectSegment,
  DEFAULT_BAR_COLORS,
  getDaysInMonth,
  getDaysInWeek,
  getWeekStart,
  assignRows,
  assignColors,
  hexToRgba,
  lightenColor,
  hexToRgbaBackground,
  truncateTitle,
  getFontFamily,
  formatDate,
  addDays,
  daysBetween,
} from "@/lib/calendarUtils";

interface CalendarConfig {
  id: string;
  notionConfig: {
    apiKey: string;
    databaseId: string;
    dateProperty: string;
    titleProperty: string;
  };
  theme: CalendarTheme;
}

interface CalendarTheme {
  primaryColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  barColors: string[];
  labelColor: string;
  multiRow: boolean;
  darkMode: boolean;
  weekView?: boolean;
}

interface CalendarWidgetProps {
  configId: string;
  config?: CalendarConfig;
  theme?: CalendarTheme;
  fontFamily?: string;
  previewProjects?: Project[];
}

const DAY_WIDTH = 25;
const WEEK_DAY_WIDTH = 100;
const ROW_HEIGHT = 26;
const BAR_HEIGHT = 22;

export default function CalendarWidget({
  configId,
  config,
  theme,
  fontFamily = "Pretendard",
  previewProjects,
}: CalendarWidgetProps) {
  const [centerYear, setCenterYear] = useState<number | null>(null);
  const [centerMonth, setCenterMonth] = useState<number | null>(null);
  const [todayStr, setTodayStr] = useState<string>("");
  const [weekStartStr, setWeekStartStr] = useState<string>("");

  useEffect(() => {
    const now = new Date();
    setCenterYear(now.getFullYear());
    setCenterMonth(now.getMonth());
    setTodayStr(now.toDateString());
    setWeekStartStr(formatDate(getWeekStart(now)));
  }, []);

  const [projects, setProjects] = useState<ProjectSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [rowOverrides, setRowOverrides] = useState<Map<string, number>>(new Map());
  const [dateOverrides, setDateOverrides] = useState<Map<string, { startDate: string; endDate: string }>>(new Map());
  const [dropDateStr, setDropDateStr] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, text: "", color: "" });
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrolledRef = useRef(false);
  const dragGrabDate = useRef<string | null>(null);
  const dragMode = useRef<"move" | "resize-start" | "resize-end" | null>(null);

  const primaryColor = theme?.primaryColor ?? "#E8A8C0";
  const backgroundOpacity = theme?.backgroundOpacity ?? 100;
  const rawBg = theme?.backgroundColor ?? "#FFFFFF";
  const barColors = theme?.barColors ?? DEFAULT_BAR_COLORS;
  const labelColor = theme?.labelColor ?? "#444444";
  const multiRow = theme?.multiRow ?? false;
  const darkMode = theme?.darkMode ?? false;
  const weekView = theme?.weekView ?? false;

  const bgColor = rawBg.startsWith("rgba") ? rawBg : hexToRgbaBackground(rawBg, backgroundOpacity);
  const headerBg = lightenColor(primaryColor, 0.85);
  const font = getFontFamily(fontFamily);

  const year = centerYear ?? new Date().getFullYear();
  const month = centerMonth ?? new Date().getMonth();

  const prevDays = getDaysInMonth(
    new Date(year, month - 1, 1).getFullYear(),
    new Date(year, month - 1, 1).getMonth()
  );
  const currDays = getDaysInMonth(year, month);
  const nextDays = getDaysInMonth(
    new Date(year, month + 1, 1).getFullYear(),
    new Date(year, month + 1, 1).getMonth()
  );
  const allDays = [...prevDays, ...currDays, ...nextDays];

  const weekStartDate = weekStartStr ? new Date(weekStartStr + "T00:00:00") : new Date();
  const prevWeekStart = new Date(weekStartDate); prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const nextWeekStart = new Date(weekStartDate); nextWeekStart.setDate(nextWeekStart.getDate() + 7);
  const prevWeekDays = weekView && weekStartStr ? getDaysInWeek(prevWeekStart) : [];
  const weekDays     = weekView && weekStartStr ? getDaysInWeek(weekStartDate) : [];
  const nextWeekDays = weekView && weekStartStr ? getDaysInWeek(nextWeekStart) : [];
  const allWeekDays  = [...prevWeekDays, ...weekDays, ...nextWeekDays];

  const dayWidth = weekView ? WEEK_DAY_WIDTH : DAY_WIDTH;
  const displayDays = weekView ? allWeekDays : allDays;

  const fetchStart = weekView && weekStartStr
    ? formatDate(new Date(prevWeekStart.getFullYear(), prevWeekStart.getMonth() - 1, 1))
    : formatDate(new Date(year, month - 1, 1));
  const fetchEnd = weekView && allWeekDays.length > 0
    ? allWeekDays[allWeekDays.length - 1].dateStr
    : formatDate(new Date(year, month + 2, 0));

  useEffect(() => { scrolledRef.current = false; }, [year, month, weekStartStr]);

  useEffect(() => {
    if (!loading && !scrolledRef.current && bodyRef.current) {
      const offset = weekView
        ? prevWeekDays.length * WEEK_DAY_WIDTH + 12
        : prevDays.length * DAY_WIDTH + 12;
      bodyRef.current.scrollLeft = offset;
      scrolledRef.current = true;
    }
  }, [loading, prevDays.length, prevWeekDays.length, weekView]);

  const getPreviewProjects = useCallback((): Project[] => {
    const d = (monthOffset: number, day: number): string => {
      const dt = new Date(year, month + monthOffset, 1);
      const lastDay = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
      return formatDate(new Date(dt.getFullYear(), dt.getMonth(), Math.min(day, lastDay)));
    };
    return [
      { id: "s1", title: "Website Redesign", startDate: d(-1, 20), endDate: d(0, 4),  pageUrl: "#" },
      { id: "s2", title: "Mobile App MVP",   startDate: d(0, 6),   endDate: d(0, 10), pageUrl: "#" },
      { id: "s3", title: "QA Testing",       startDate: d(0, 12),  endDate: d(0, 14), pageUrl: "#" },
      { id: "s4", title: "Final Launch",     startDate: d(0, 17),  endDate: d(1, 5),  pageUrl: "#" },
      { id: "s5", title: "Design Polish",    startDate: d(0, 21),  endDate: d(0, 24), pageUrl: "#" },
    ];
  }, [year, month]);

  const fetchProjects = useCallback(async () => {
    if (centerYear === null || centerMonth === null) return;
    setLoading(true);
    setError(null);

    if (configId === "preview") {
      const raw = previewProjects ?? getPreviewProjects();
      setProjects(assignColors(raw, barColors));
      setLoading(false);
      return;
    }

    if (config) {
      try {
        const res = await fetch("/api/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            config: {
              token: config.notionConfig.apiKey,
              dbId: config.notionConfig.databaseId,
              dateProp: config.notionConfig.dateProperty,
              titleProp: config.notionConfig.titleProperty,
            },
            startDate: fetchStart,
            endDate: fetchEnd,
          }),
        });
        if (!res.ok) throw new Error("Failed to fetch");
        const json = await res.json();
        setProjects(json.success && json.data ? assignColors(json.data, barColors) : []);
      } catch (e) {
        console.error(e);
        setError("프로젝트를 불러올 수 없습니다.");
        setProjects([]);
      } finally {
        setLoading(false);
      }
      return;
    }

    setLoading(false);
  }, [configId, config, centerYear, centerMonth, fetchStart, fetchEnd, barColors, previewProjects, getPreviewProjects]);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  const navigateMonth = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setCenterYear(d.getFullYear());
    setCenterMonth(d.getMonth());
    setRowOverrides(new Map());
  };

  const navigateWeek = (delta: number) => {
    setWeekStartStr((prev) => {
      if (!prev) return prev;
      const d = new Date(prev + "T00:00:00");
      d.setDate(d.getDate() + delta * 7);
      return formatDate(d);
    });
    setRowOverrides(new Map());
  };

  const formatShortDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  // Apply local date overrides on top of Notion data
  const effectiveProjects = projects.map(p => {
    const o = dateOverrides.get(p.id);
    return o ? { ...p, ...o } : p;
  });

  const rowMap = assignRows(effectiveProjects, multiRow);
  const effectiveRowMap = new Map(rowMap);
  rowOverrides.forEach((row, id) => {
    if (effectiveRowMap.has(id)) effectiveRowMap.set(id, row);
  });

  const rowValues = Array.from(effectiveRowMap.values());
  const maxRow = rowValues.length > 0 ? Math.max(...rowValues) + 1 : 1;
  const totalRows = Math.max(dragId ? Math.max(maxRow, 2) : maxRow, 1);

  function getSegmentsForDay(dateStr: string): ProjectSegment[] {
    return effectiveProjects
      .filter((p) => dateStr >= p.startDate && dateStr <= p.endDate)
      .map((p) => {
        const isStart = dateStr === p.startDate;
        const isEnd = dateStr === p.endDate;
        const duration = isStart
          ? Math.round((new Date(p.endDate + "T00:00:00").getTime() - new Date(p.startDate + "T00:00:00").getTime()) / 86400000) + 1
          : 0;
        return { ...p, isStart, isEnd, duration, rowIndex: 0 };
      });
  }

  if (centerYear === null || centerMonth === null) {
    return (
      <div style={{
        fontFamily: font, background: bgColor,
        border: darkMode ? "none" : `1px solid ${primaryColor}`,
        outline: darkMode ? "none" : `2px solid ${lightenColor(primaryColor, 0.85)}`,
        borderRadius: 10, overflow: "hidden",
        padding: "20px 40px", fontSize: 11, color: "#aaa",
        minWidth: 200,
      }}>
        로딩 중...
      </div>
    );
  }

  const centerMonthLabel = new Date(year, month).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const weekLabel = weekView && weekDays.length > 0 ? (() => {
    const s = weekDays[0].dateObj;
    const e = weekDays[6].dateObj;
    const sm = s.toLocaleDateString("en-US", { month: "short" });
    const em = e.toLocaleDateString("en-US", { month: "short" });
    return s.getMonth() === e.getMonth()
      ? `${sm} ${s.getDate()} – ${e.getDate()}, ${s.getFullYear()}`
      : `${sm} ${s.getDate()} – ${em} ${e.getDate()}, ${e.getFullYear()}`;
  })() : "";

  const headerLabel = weekView ? weekLabel : centerMonthLabel;

  return (
    <>
      <style>{`
        @import url("https://cdn.jsdelivr.net/npm/galmuri@latest/dist/galmuri.css");
        @import url("https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css");
      `}</style>

      <div style={{
        fontFamily: font, background: bgColor,
        border: darkMode ? "none" : `1px solid ${primaryColor}`,
        outline: darkMode ? "none" : `2px solid ${headerBg}`,
        boxShadow: darkMode ? "none" : `2px 2px 0px ${primaryColor}4D, 4px 4px 12px ${primaryColor}26`,
        borderRadius: 10, overflow: "hidden", userSelect: "none",
        width: "fit-content", maxWidth: "98vw",
        display: "flex", flexDirection: "column", position: "relative",
      }}>
        <div style={{
          height: 22, background: headerBg, borderBottom: `1px solid ${primaryColor}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 12px", fontSize: 11, color: primaryColor,
          fontWeight: "bold", letterSpacing: 0.2, flexShrink: 0,
        }}>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <Link size={12} strokeWidth={2.5} />
            {headerLabel} Timeline
            <span style={{ display: "flex", gap: 2, alignItems: "center", marginLeft: 2 }}>
              <button onClick={() => weekView ? navigateWeek(-1) : navigateMonth(-1)}
                aria-label="Previous" style={{ cursor: "pointer", padding: 2, borderRadius: 4, color: primaryColor, display: "flex", alignItems: "center", background: "none", border: "none" }}>
                <ChevronLeft size={14} />
              </button>
              <button onClick={() => weekView ? navigateWeek(1) : navigateMonth(1)}
                aria-label="Next" style={{ cursor: "pointer", padding: 2, borderRadius: 4, color: primaryColor, display: "flex", alignItems: "center", background: "none", border: "none" }}>
                <ChevronRight size={14} />
              </button>
            </span>
          </span>
          <span style={{ fontSize: 6, color: primaryColor, letterSpacing: 1, opacity: 0.7 }}>PROJECT CAL</span>
        </div>

        {error && (
          <div style={{ textAlign: "center", padding: 12, color: "#e53e3e", fontSize: 11 }}>{error}</div>
        )}

        {loading ? (
          <div style={{ textAlign: "center", padding: 12, color: "#888", fontSize: 11 }}>Loading...</div>
        ) : (
          <div
            ref={bodyRef}
            onWheel={(e) => { if (bodyRef.current) bodyRef.current.scrollLeft += e.deltaY; }}
            style={{
              padding: "10px 0 18px", overflowX: "auto", overflowY: "hidden",
              display: "flex", background: bgColor,
              scrollbarWidth: "thin", scrollbarColor: `${primaryColor}40 transparent`,
            }}
          >
            <div style={{ display: "flex", padding: "0 12px", minWidth: "min-content" }}>
              {displayDays.map((day) => {
                const { dateStr } = day;
                const isMonthBoundary = day.day === 1;
                const segments = getSegmentsForDay(dateStr);
                const dow = day.dateObj.getDay();
                const isWeekend = dow === 0 || dow === 6;
                const isToday = todayStr === day.dateObj.toDateString();
                const isCurrWeek = weekView
                  ? weekDays.some((d) => d.dateStr === dateStr)
                  : (day.dateObj.getMonth() === month && day.dateObj.getFullYear() === year);
                const isColDrop = !!dragId && dropDateStr === dateStr;

                return (
                  <div key={dateStr} style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    width: dayWidth, flexShrink: 0,
                    opacity: isCurrWeek ? 1 : 0.55,
                  }}>
                    {/* Date header */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 6, height: 34, position: "relative" }}>
                      {isMonthBoundary ? (
                        <span style={{
                          fontSize: 7, fontWeight: 700, color: primaryColor, letterSpacing: 0.5,
                          whiteSpace: "nowrap", lineHeight: 1, marginBottom: 2,
                          borderLeft: `2px solid ${primaryColor}`, paddingLeft: 3,
                        }}>
                          {day.dateObj.toLocaleDateString("en-US", { month: "short" })}
                        </span>
                      ) : (
                        <span style={{ height: 9, display: "block" }} />
                      )}
                      <span style={{
                        fontSize: weekView ? 10 : 8, color: isWeekend ? primaryColor : "#bbb",
                        textTransform: "uppercase", lineHeight: 1, marginBottom: 1,
                      }}>
                        {day.dayName}
                      </span>
                      <span style={{
                        fontSize: weekView ? 13 : 10, fontWeight: 600,
                        color: isToday ? "white" : isWeekend ? primaryColor : "#555",
                        width: weekView ? 22 : 16, height: weekView ? 22 : 16,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        borderRadius: "50%",
                        background: isToday ? primaryColor : isWeekend ? headerBg : "transparent",
                      }}>
                        {day.day}
                      </span>
                      {isToday && (
                        <div style={{ position: "absolute", top: -2, width: 3, height: 3, borderRadius: "50%", background: primaryColor }} />
                      )}
                    </div>

                    {/* Drop zone — handles all drag modes */}
                    <div
                      style={{
                        height: `${totalRows * ROW_HEIGHT}px`, width: "100%", position: "relative",
                        background: isColDrop ? hexToRgba(primaryColor, 0.12) : "transparent",
                        transition: "background 0.1s",
                        borderRadius: 4,
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        setDropDateStr(dateStr);
                      }}
                      onDragLeave={() => setDropDateStr(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        const sourceId = e.dataTransfer.getData("application/x-project-id") || e.dataTransfer.getData("text/plain") || dragId || "";
                        if (!sourceId) { setDragId(null); setDropDateStr(null); dragMode.current = null; dragGrabDate.current = null; return; }
                        const mode = dragMode.current;
                        const project = effectiveProjects.find(p => p.id === sourceId);
                        if (project) {
                          if (mode === "move" && dragGrabDate.current) {
                            const delta = daysBetween(dragGrabDate.current, dateStr);
                            if (delta !== 0) {
                              setDateOverrides(prev => { const next = new Map(prev); next.set(sourceId, { startDate: addDays(project.startDate, delta), endDate: addDays(project.endDate, delta) }); return next; });
                              setRowOverrides(prev => { const next = new Map(prev); next.delete(sourceId); return next; });
                            }
                          } else if (mode === "resize-end") {
                            const newEnd = dateStr >= project.startDate ? dateStr : project.startDate;
                            setDateOverrides(prev => { const next = new Map(prev); next.set(sourceId, { startDate: project.startDate, endDate: newEnd }); return next; });
                          } else if (mode === "resize-start") {
                            const newStart = dateStr <= project.endDate ? dateStr : project.endDate;
                            setDateOverrides(prev => { const next = new Map(prev); next.set(sourceId, { startDate: newStart, endDate: project.endDate }); return next; });
                          }
                        }
                        setDragId(null); setDropDateStr(null); dragMode.current = null; dragGrabDate.current = null;
                      }}
                    >
                      {segments.map((seg) => {
                        const isHovered = hoveredId === seg.id;
                        const isDragging = dragId === seg.id;
                        const row = effectiveRowMap.get(seg.id) ?? 0;
                        const zIdx = isHovered ? (seg.isStart ? 210 : 200) : hoveredId ? 0 : (seg.isStart ? 2 : 1);
                        const bgC = isHovered ? seg.color : hexToRgba(seg.color, 0.55);

                        const isMonthStart = isMonthBoundary && dateStr > seg.startDate;
                        const showLabel = seg.isStart || isMonthStart;
                        const labelDuration = seg.isStart
                          ? seg.duration
                          : Math.round(
                              (new Date(seg.endDate + "T00:00:00").getTime() - new Date(dateStr + "T00:00:00").getTime()) / 86400000
                            ) + 1;

                        const shapeStyle: React.CSSProperties =
                          seg.isStart && seg.isEnd
                            ? { borderRadius: 4, margin: "0 2px", width: "calc(100% - 4px)" }
                            : seg.isStart
                            ? { borderTopLeftRadius: 4, borderBottomLeftRadius: 4, marginLeft: 2, width: "calc(100% - 2px)" }
                            : seg.isEnd
                            ? { borderTopRightRadius: 4, borderBottomRightRadius: 4, marginRight: 2, width: "calc(100% - 2px)" }
                            : { width: "100%" };

                        return (
                          <div
                            key={seg.id}
                            style={{
                              height: BAR_HEIGHT, display: "flex", alignItems: "center",
                              justifyContent: "center", position: "absolute", color: "white",
                              fontSize: 10, fontWeight: "bold", overflow: "visible",
                              transition: "background-color .2s", cursor: isDragging ? "grabbing" : "grab",
                              left: 0, zIndex: zIdx, backgroundColor: bgC,
                              top: `${row * ROW_HEIGHT}px`,
                              ...shapeStyle,
                              ...(isDragging ? { opacity: 0.3 } : {}),
                            }}
                            draggable
                            onDragStart={(e) => {
                              dragMode.current = "move";
                              dragGrabDate.current = dateStr;
                              setDragId(seg.id);
                              setDropDateStr(null);
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("application/x-project-id", seg.id);
                              e.dataTransfer.setData("text/plain", seg.id);
                            }}
                            onDragEnd={() => {
                              setDragId(null); setDropDateStr(null);
                              dragMode.current = null; dragGrabDate.current = null;
                            }}
                            onMouseEnter={(e) => {
                              setHoveredId(seg.id);
                              setTooltip({
                                visible: true, x: e.clientX, y: e.clientY,
                                text: `${formatShortDate(seg.startDate)} ~ ${formatShortDate(seg.endDate)}`,
                                color: seg.color,
                              });
                            }}
                            onMouseMove={(e) => {
                              if (tooltip.visible) setTooltip((t) => ({ ...t, x: e.clientX, y: e.clientY }));
                            }}
                            onMouseLeave={() => {
                              setHoveredId(null);
                              setTooltip((t) => ({ ...t, visible: false }));
                            }}
                          >
                            {/* Left resize handle (start) */}
                            {seg.isStart && (
                              <div
                                draggable
                                style={{
                                  position: "absolute", left: 0, top: 0, width: 7, height: "100%",
                                  cursor: "ew-resize", zIndex: 20,
                                  borderTopLeftRadius: 4, borderBottomLeftRadius: 4,
                                  background: "rgba(255,255,255,0.25)",
                                }}
                                onMouseDown={e => e.stopPropagation()}
                                onDragStart={e => {
                                  e.stopPropagation();
                                  dragMode.current = "resize-start";
                                  setDragId(seg.id);
                                  setDropDateStr(null);
                                  e.dataTransfer.effectAllowed = "move";
                                  e.dataTransfer.setData("application/x-project-id", seg.id);
                                  e.dataTransfer.setData("text/plain", seg.id);
                                }}
                                onDragEnd={e => {
                                  e.stopPropagation();
                                  setDragId(null); setDropDateStr(null);
                                  dragMode.current = null;
                                }}
                              />
                            )}

                            {/* Right resize handle (end) */}
                            {seg.isEnd && (
                              <div
                                draggable
                                style={{
                                  position: "absolute", right: 0, top: 0, width: 7, height: "100%",
                                  cursor: "ew-resize", zIndex: 20,
                                  borderTopRightRadius: 4, borderBottomRightRadius: 4,
                                  background: "rgba(255,255,255,0.25)",
                                }}
                                onMouseDown={e => e.stopPropagation()}
                                onDragStart={e => {
                                  e.stopPropagation();
                                  dragMode.current = "resize-end";
                                  setDragId(seg.id);
                                  setDropDateStr(null);
                                  e.dataTransfer.effectAllowed = "move";
                                  e.dataTransfer.setData("application/x-project-id", seg.id);
                                  e.dataTransfer.setData("text/plain", seg.id);
                                }}
                                onDragEnd={e => {
                                  e.stopPropagation();
                                  setDragId(null); setDropDateStr(null);
                                  dragMode.current = null;
                                }}
                              />
                            )}

                            {showLabel && (
                              <span style={{
                                position: "absolute", left: 2, display: "flex",
                                justifyContent: "flex-start", alignItems: "center",
                                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                pointerEvents: "none", fontSize: 9, color: labelColor,
                                height: "100%", boxSizing: "border-box", padding: "0 6px",
                                width: `${Math.max(dayWidth * Math.max(labelDuration, 1) - 4, 21)}px`,
                                zIndex: isHovered ? 201 : 3,
                              }}>
                                {truncateTitle(seg.title, Math.max(labelDuration, 1), dayWidth)}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <button onClick={fetchProjects} aria-label="Refresh"
          style={{
            cursor: "pointer", color: primaryColor, display: "flex",
            justifyContent: "center", alignItems: "center", transition: "all .2s",
            background: "none", border: "none", padding: "1px 2px", fontSize: 14,
            lineHeight: 1, opacity: 0.75, position: "absolute", right: 8, bottom: 10, zIndex: 30,
          }}
        >↻</button>
      </div>

      {tooltip.visible && (
        <div style={{
          position: "fixed", zIndex: 9999, padding: "4px 8px", borderRadius: 6,
          fontSize: 10, fontWeight: "bold", color: "#555", pointerEvents: "none",
          boxShadow: "2px 2px 8px rgba(0,0,0,.1)", border: "1px solid rgba(255,255,255,.5)",
          transform: "translate(-50%, 15px)", whiteSpace: "nowrap",
          left: tooltip.x, top: tooltip.y, backgroundColor: tooltip.color,
        }}>
          {tooltip.text}
        </div>
      )}
    </>
  );
}
