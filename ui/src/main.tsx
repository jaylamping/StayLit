import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Home } from "@/home";
import { Theme } from "@/theme";
import { openWindow } from "@/store";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing root");

createRoot(root).render(
  <StrictMode>
    <Theme />
    <Home />
  </StrictMode>,
);

openWindow();
