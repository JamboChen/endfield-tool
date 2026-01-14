import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import "./i18n";
import { preloadLayoutEngine } from "./lib/layout";

// Eagerly preload the layout engine in the background as soon as the app starts
preloadLayoutEngine();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
