"use client";

import { useEffect } from "react";

export default function GCalCallback() {
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const code = searchParams.get("code");
    const error = searchParams.get("error");

    if (error || !code) {
      document.body.innerHTML =
        '<div style="font-family:sans-serif;text-align:center;padding-top:80px;color:#e53e3e">인증에 실패했습니다. 이 창을 닫아주세요.</div>';
      return;
    }

    const redirectUri = `${window.location.origin}/gcal-callback`;
    fetch("/api/gcal-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, redirect_uri: redirectUri }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.access_token && window.opener) {
          window.opener.postMessage(
            {
              type: "gcal-token",
              token: data.access_token,
              refreshToken: data.refresh_token ?? null,
              expiresIn: String(data.expires_in ?? 3600),
            },
            window.location.origin
          );
          window.close();
        } else {
          document.body.innerHTML =
            '<div style="font-family:sans-serif;text-align:center;padding-top:80px;color:#e53e3e">토큰 발급에 실패했습니다. 이 창을 닫아주세요.</div>';
        }
      })
      .catch(() => {
        document.body.innerHTML =
          '<div style="font-family:sans-serif;text-align:center;padding-top:80px;color:#e53e3e">오류가 발생했습니다. 이 창을 닫아주세요.</div>';
      });
  }, []);

  return (
    <div style={{ fontFamily: "sans-serif", textAlign: "center", paddingTop: 80, color: "#888" }}>
      Google Calendar 인증 중...
    </div>
  );
}
