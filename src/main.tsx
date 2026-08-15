import React from "react";
import ReactDOM from "react-dom/client";
import AppShell from "./app/AppShell";
import { bootstrapInterfaceZoom } from "./platform/dpi";
import "./styles.css";

void bootstrapInterfaceZoom();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>,
);
