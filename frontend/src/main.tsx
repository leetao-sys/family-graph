import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { AuthProvider } from "./auth";
import { applyStoredPrefs } from "./theme";
import { UIProvider } from "./ui";
import "./styles.css";

applyStoredPrefs();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <UIProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </UIProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
