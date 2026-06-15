"use client";

import { useEffect } from "react";

export default function GCalCallback() {
  useEffect(() => {
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const accessToken = params.get("access_token");
    const expiresIn = params.get("expires_in");

    if (accessToken && window.opener) {
      window.opener.postMessage(
        { type: "gcal-token", token: accessToken, expiresIn: expiresIn || "3600" },
        window.location.origin
      );
      window.close();
    } else {
      document.body.innerHTML =
        '<div style="font-family:sans-serif;text-align:center;padding-top:80px;color:#e53e3e">인증에 실패했습니다. 이 창을 닫아주세요.</div>';
    }
  }, []);

  return (
    <div style={{ fontFamily: "sans-serif", textAlign: "center", paddingTop: 80, color: "#888" }}>
      Google Calendar 인증 중...
    </div>
  );
}
