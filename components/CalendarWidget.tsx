"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { ChevronLeft, ChevronRight, Link } from "lucide-react";
import {
  Project,
  ProjectSegment,
  DEFAULT_BAR_COLORS,
  getDaysInMonth,
  getSegmentsForDay,
  assignRows,
  assignColors,
  hexToRgba,
  lightenColor,
  hexToRgbaBackground,
  truncateTitle,
  getFontFamily,
  formatDate,
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
}

interface CalendarWidgetProps {
  configId: string;
  config?: CalendarConfig;
  theme?: CalendarTheme;
  fontFamily?: string;
  previewProjects?: Project[];
}

const DAY_WIDTH = 25;
const ROW_HEIGHT = 26;
const BAR_HEIGHT = 22;

export default function CalendarWidget({
  configId,
  config,
  theme,
  fontFamily = "Pretendard",
  previewProjects,
}: CalendarWidgetProps) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [projects, setProjects] = useState<ProjectSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ type: string; projectId?: string; row?: number } | null>(null);
  const [rowOverrides, setRowOverrides] = useState<Map<string, number>>(new Map());
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, text: "", color: "" });
  const bodyRef = useRef<HTMLDivElement>(null);

  const primaryColor = theme?.primaryColor ?? "#E8A8C0";
  const backgroundOpacity = theme?.backgroundOpacity ?? 100;
  const rawBg = theme?.backgroundColor ?? "#FFFFFF";
  const barColors = theme?.barColors ?? DEFAULT_BAR_COLORS;
  const labelColor = theme?.labelColor ?? "#444444";
  const multiRow = theme?.multiRow ?? false;
  const darkMode = theme?.darkMode ?? false;

  const bgColor = rawBg.startsWith("rgba") ? rawBg : hexToRgbaBackground(rawBg, backgroundOpacity);
  const headerBg = lightenColor(primaryColor, 0.85);
  const font = getFontFamily(fontFamily);

  const getPreviewProjects = useCallback((): Project[] => {
    const pad = (n: number) => String(n).padStart(2, "0");
    const d = (day: number) => `${year}-${pad(month + 1)}-${pad(Math.min(day, new Date(year, month + 1, 0).getDate()))}`;
    const base = [
      { id: "s1", title: "Website Redesign", startDate: d(1), endDate: d(4), pageUrl: "#" },
      { id: "s2", title: "Mobile App MVP", startDate: d(6), endDate: d(10), pageUrl: "#" },
      { id: "s3", title: "QA Testing", startDate: d(12), endDate: d(14), pageUrl: "#" },
      { id: "s4", title: "Final Launch", startDate: d(17), endDate: d(22), pageUrl: "#" },
      { id: "s5", title: "Design Polish", startDate: d(21), endDate: d(24), pageUrl: "#" },
    ];
    return base;
  }, [year, month]);

  const fetchProjects = useCallback(async () => {
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
        const startDate = formatDate(new Date(year, month, 1));
        const endDate = formatDate(new Date(year, month + 1, 0));
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
            startDate,
            endDate,
          }),
        });
        if (!res.ok) throw new Error("Failed to fetch projects");
        const json = await res.json();
        if (json.success && json.data) {
          setProjects(assignColors(json.data, barColors));
        } else {
          setProjects([]);
        }
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
  }, [configId, config, year, month, barColors, previewProjects, getPreviewProjects]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const navigateMonth = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
    setRowOverrides(new Map());
  };

  const formatShortDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const rowMap = assignRows(projects, multiRow);
  const effectiveRowMap = new Map(rowMap);
  rowOverrides.forEach((row, id) => {
    if (effectiveRowMap.has(id)) effectiveRowMap.set(id, row);
  });

  const maxRow = projects.length > 0 ? Math.max(...Array.from(effectiveRowMap.values())) + 1 : 1;
  const totalRows = dragId ? Math.max(maxRow, 2) : maxRow;

  const getDragId = (e: React.DragEvent) =>
    dragId || e.dataTransfer.getData("application/x-project-id") || e.dataTransfer.getData("text/plain");

  const getTargetRow = (e: React.DragEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(totalRows - 1, Math.floor((e.clientY - rect.top) / ROW_HEIGHT)));
  };

  const handleSwap = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const sourceId = getDragId(e);
    if (!sourceId || sourceId === targetId) { setDragId(null); setDropTarget(null); return; }
    const sourceRow = effectiveRowMap.get(sourceId);
    const targetRow = effectiveRowMap.get(targetId);
    if (sourceRow === undefined || targetRow === undefined || sourceRow === targetRow) {
      setDragId(null); setDropTarget(null); return;
    }
    setRowOverrides((prev) => {
      const next = new Map(prev);
      next.set(sourceId, targetRow);
      next.set(targetId, sourceRow);
      return next;
    });
    setDragId(null);
    setDropTarget(null);
  };

  const days = getDaysInMonth(year, month);

  const windowStyle: React.CSSProperties = {
    fontFamily: font,
    background: bgColor,
    border: darkMode ? "none" : `1px solid ${primaryColor}`,
    outline: darkMode ? "none" : `2px solid ${headerBg}`,
    boxShadow: darkMode ? "none" : `2px 2px 0px ${primaryColor}4D, 4px 4px 12px ${primaryColor}26`,
    borderRadius: 10,
    overflow: "hidden",
    userSelect: "none",
    width: "fit-content",
    maxWidth: "98vw",
    display: "flex",
    flexDirection: "column",
    position: "relative",
  };

  const headerStyle: React.CSSProperties = {
    height: 22,
    background: headerBg,
    borderBottom: `1px solid ${primaryColor}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 12px",
    fontSize: 11,
    color: primaryColor,
    fontWeight: "bold",
    letterSpacing: 0.2,
    flexShrink: 0,
  };

  return (
    <>
      <style>{`
        @import url("https://cdn.jsdelivr.net/npm/galmuri@latest/dist/galmuri.css");
        @import url("https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css");
      `}</style>
      <div style={windowStyle}>
        {/* Title bar */}
        <div style={headerStyle}>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <Link size={12} strokeWidth={2.5} />
            {new Date(year, month).toLocaleDateString("en-US", { month: "long" })} Timeline
            <span style={{ display: "flex", gap: 2, alignItems: "center", marginLeft: 2 }}>
              <button
                onClick={() => navigateMonth(-1)}
                aria-label="Previous month"
                style={{
                  cursor: "pointer", padding: 2, borderRadius: 4, color: primaryColor,
                  display: "flex", alignItems: "center", background: "none", border: "none",
                }}
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => navigateMonth(1)}
                aria-label="Next month"
                style={{
                  cursor: "pointer", padding: 2, borderRadius: 4, color: primaryColor,
                  display: "flex", alignItems: "center", background: "none", border: "none",
                }}
              >
                <ChevronRight size={14} />
              </button>
            </span>
          </span>
          <span style={{ fontSize: 6, color: primaryColor, letterSpacing: 1, opacity: 0.7 }}>
            PROJECT CAL
          </span>
        </div>

        {/* Error / Loading */}
        {error && (
          <div style={{ textAlign: "center", padding: 12, color: "#e53e3e", fontSize: 11 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: "center", padding: 12, color: "#888", fontSize: 11 }}>
            Loading...
          </div>
        ) : (
          <div
            ref={bodyRef}
            onWheel={(e) => { if (bodyRef.current) bodyRef.current.scrollLeft += e.deltaY; }}
            style={{
              padding: "10px 0 18px",
              overflowX: "auto",
              display: "flex",
              background: bgColor,
              scrollbarWidth: "thin",
              scrollbarColor: `${primaryColor}40 transparent`,
            }}
          >
            <div style={{ display: "flex", padding: "0 12px", minWidth: "min-content" }}>
              {days.map((day) => {
                const segments = getSegmentsForDay(projects, day.dateStr);
                const dow = day.dateObj.getDay();
                const isWeekend = dow === 0 || dow === 6;
                const isToday = new Date().toDateString() === day.dateObj.toDateString();

                return (
                  <div
                    key={day.dateStr}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center", width: DAY_WIDTH, flexShrink: 0 }}
                  >
                    {/* Day header */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0, marginBottom: 6, height: 22, position: "relative" }}>
                      <span style={{ fontSize: 8, color: isWeekend ? primaryColor : "#bbb", textTransform: "uppercase", lineHeight: 1, marginBottom: 1 }}>
                        {day.dayName}
                      </span>
                      <span style={{
                        fontSize: 10, fontWeight: 600,
                        color: isToday ? "white" : isWeekend ? primaryColor : "#555",
                        width: 16, height: 16, display: "flex", alignItems: "center", justifyContent: "center",
                        borderRadius: "50%",
                        background: isToday ? primaryColor : isWeekend ? headerBg : "transparent",
                      }}>
                        {day.day}
                      </span>
                      {isToday && (
                        <div style={{ position: "absolute", top: -2, width: 3, height: 3, borderRadius: "50%", background: primaryColor }} />
                      )}
                    </div>

                    {/* Project rows */}
                    <div
                      style={{ height: `${totalRows * ROW_HEIGHT}px`, width: "100%", position: "relative" }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        setDropTarget({ type: "row", row: getTargetRow(e) });
                      }}
                      onDrop={(e) => {
                        if (dropTarget?.type === "project" && dropTarget.projectId) {
                          handleSwap(e, dropTarget.projectId);
                          return;
                        }
                        const targetRow = getTargetRow(e);
                        const sourceId = getDragId(e);
                        if (!sourceId) { setDragId(null); setDropTarget(null); return; }
                        const currentRow = effectiveRowMap.get(sourceId);
                        if (currentRow === undefined || currentRow === targetRow) { setDragId(null); setDropTarget(null); return; }
                        setRowOverrides((prev) => { const next = new Map(prev); next.set(sourceId, targetRow); return next; });
                        setDragId(null);
                        setDropTarget(null);
                      }}
                    >
                      {/* Drop zone indicators */}
                      {Array.from({ length: totalRows }).map((_, rowIdx) => {
                        const active = dragId !== null && dropTarget?.type === "row" && dropTarget.row === rowIdx;
                        return (
                          <div
                            key={`${day.dateStr}-drop-${rowIdx}`}
                            style={{
                              position: "absolute", top: rowIdx * ROW_HEIGHT, left: 0, width: "100%", height: BAR_HEIGHT,
                              borderRadius: 4, zIndex: 0, transition: "all .15s ease",
                              opacity: active ? 1 : 0, pointerEvents: "none",
                              border: active ? `2px dashed ${primaryColor}` : "none",
                              background: active ? hexToRgba(primaryColor, 0.14) : "transparent",
                            }}
                          />
                        );
                      })}

                      {/* Project segments */}
                      {segments.map((seg) => {
                        const isHovered = hoveredId === seg.id;
                        const isDragging = dragId === seg.id;
                        const isDropTarget = dropTarget?.type === "project" && dropTarget.projectId === seg.id;
                        const row = effectiveRowMap.get(seg.id) ?? 0;
                        const zIdx = isHovered ? (seg.isStart ? 210 : 200) : hoveredId ? 0 : (seg.isStart ? 2 : 1);
                        const bgC = isHovered ? seg.color : hexToRgba(seg.color, 0.55);

                        const shapeStyle: React.CSSProperties =
                          seg.isStart && seg.isEnd
                            ? { borderRadius: 4, margin: "0 2px", width: "calc(100% - 4px)" }
                            : seg.isStart
                            ? { borderTopLeftRadius: 4, borderBottomLeftRadius: 4, marginLeft: 2, width: "calc(100% - 2px)" }
                            : seg.isEnd
                            ? { borderTopRightRadius: 4, borderBottomRightRadius: 4, marginRight: 2, width: "calc(100% - 2px)" }
                            : { width: "100%" };

                        const segStyle: React.CSSProperties = {
                          height: BAR_HEIGHT,
                          width: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          position: "absolute",
                          color: "white",
                          fontSize: 10,
                          fontWeight: "bold",
                          overflow: "visible",
                          transition: "background-color .2s",
                          cursor: "grab",
                          left: 0,
                          zIndex: zIdx,
                          backgroundColor: bgC,
                          top: `${row * ROW_HEIGHT}px`,
                          ...shapeStyle,
                          ...(isDragging ? { opacity: 0.3, cursor: "grabbing" } : {}),
                          ...(isDropTarget ? {
                            boxShadow: `0 0 0 2px ${hexToRgba("#FFFFFF", 0.95)}, 0 0 0 4px ${hexToRgba(primaryColor, 0.9)}`,
                            filter: "brightness(1.04)",
                          } : {}),
                        };

                        return (
                          <div
                            key={seg.id}
                            style={segStyle}
                            draggable
                            onDragStart={(e) => {
                              setDragId(seg.id);
                              setDropTarget(null);
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("application/x-project-id", seg.id);
                              e.dataTransfer.setData("text/plain", seg.id);
                            }}
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              e.dataTransfer.dropEffect = "move";
                              setDropTarget({ type: "project", projectId: seg.id });
                            }}
                            onDrop={(e) => handleSwap(e, seg.id)}
                            onDragEnd={() => { setDragId(null); setDropTarget(null); }}
                            onMouseEnter={(e) => {
                              setHoveredId(seg.id);
                              setTooltip({
                                visible: true,
                                x: e.clientX, y: e.clientY,
                                text: `${formatShortDate(seg.startDate)} ~ ${formatShortDate(seg.endDate)}`,
                                color: seg.color,
                              });
                            }}
                            onMouseMove={(e) => {
                              if (tooltip.visible) setTooltip((t) => ({ ...t, x: e.clientX, y: e.clientY }));
                            }}
                            onMouseLeave={() => { setHoveredId(null); setTooltip((t) => ({ ...t, visible: false })); }}
                          >
                            {seg.isStart && (
                              <span
                                style={{
                                  position: "absolute", left: 2, display: "flex", justifyContent: "flex-start",
                                  alignItems: "center", whiteSpace: "nowrap", overflow: "hidden",
                                  textOverflow: "ellipsis", pointerEvents: "none", fontSize: 9,
                                  color: labelColor, height: "100%", boxSizing: "border-box", padding: "0 6px",
                                  width: `${Math.max(DAY_WIDTH * seg.duration - 4, 21)}px`,
                                  zIndex: isHovered ? 201 : 3,
                                }}
                              >
                                {truncateTitle(seg.title, seg.duration)}
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

        {/* Floating refresh */}
        <button
          onClick={fetchProjects}
          aria-label="Refresh projects"
          style={{
            cursor: "pointer", color: primaryColor, display: "flex", justifyContent: "center",
            alignItems: "center", transition: "all .2s", background: "none", border: "none",
            padding: "1px 2px", fontSize: 14, lineHeight: 1, opacity: 0.75,
            position: "absolute", right: 8, bottom: 10, zIndex: 30,
          }}
        >
          ↻
        </button>
      </div>

      {/* Tooltip */}
      {tooltip.visible && (
        <div
          style={{
            position: "fixed", zIndex: 9999, padding: "4px 8px", borderRadius: 6,
            fontSize: 10, fontWeight: "bold", color: "#555", pointerEvents: "none",
            boxShadow: "2px 2px 8px rgba(0,0,0,.1)", border: "1px solid rgba(255,255,255,.5)",
            transform: "translate(-50%, 15px)", whiteSpace: "nowrap",
            left: tooltip.x, top: tooltip.y, backgroundColor: tooltip.color,
          }}
        >
          {tooltip.text}
        </div>
      )}
    </>
  );
}
