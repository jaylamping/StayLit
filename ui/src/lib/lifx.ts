type Bridge = {
  core: {
    invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
  };
};

function bridge(): Bridge | null {
  const tauri = (window as Window & { __TAURI__?: Bridge }).__TAURI__;
  return tauri ?? null;
}

export function sidecarAvailable() {
  return bridge() !== null;
}

export async function lifx(method: string, params?: Record<string, unknown>) {
  const host = bridge();
  if (!host) return null;
  return host.core.invoke("lifx_request", { method, params: params ?? {} });
}

export async function hideWindow() {
  const host = bridge();
  if (!host) return;
  await host.core.invoke("hide_window");
}
