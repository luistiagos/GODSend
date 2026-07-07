import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

window.addEventListener("error", (e) => {
  const api = (window as any).godsendApi;
  if (api && typeof api.reportError === "function") {
    api.reportError(
      "electron-renderer",
      e.filename || "main.tsx",
      "window.onerror",
      e.message,
      window.location.href,
      [e.error?.stack || String(e.error)]
    );
  }
});

window.addEventListener("unhandledrejection", (e) => {
  const api = (window as any).godsendApi;
  if (api && typeof api.reportError === "function") {
    api.reportError(
      "electron-renderer",
      "main.tsx",
      "unhandledrejection",
      String(e.reason),
      window.location.href,
      [e.reason?.stack || String(e.reason)]
    );
  }
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
