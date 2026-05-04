"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minHeight: "100vh", padding: 24,
      fontFamily: "monospace", color: "#333",
    }}>
      <h2 style={{ color: "#e53e3e", marginBottom: 12 }}>오류가 발생했습니다</h2>
      <pre style={{
        background: "#fff5f5", border: "1px solid #fed7d7", borderRadius: 8,
        padding: 16, maxWidth: 600, whiteSpace: "pre-wrap", wordBreak: "break-all",
        fontSize: 12, color: "#c53030", marginBottom: 16,
      }}>
        {error.message || String(error)}
        {error.stack ? "\n\n" + error.stack : ""}
      </pre>
      <button onClick={reset} style={{
        background: "#e53e3e", color: "white", border: "none",
        borderRadius: 8, padding: "10px 24px", cursor: "pointer", fontSize: 14,
      }}>
        다시 시도
      </button>
    </div>
  );
}
