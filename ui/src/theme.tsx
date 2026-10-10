import { useEffect } from "react";
import { useOffice, type ThemeMode } from "@/store";

function resolved(mode: ThemeMode) {
  if (mode === "light" || mode === "dark") return mode;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function Theme() {
  const theme = useOffice((state) => state.theme);
  useEffect(() => {
    const apply = () => {
      document.documentElement.classList.toggle("dark", resolved(theme) === "dark");
    };
    apply();
    if (theme !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [theme]);
  return null;
}
