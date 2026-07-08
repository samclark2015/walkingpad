import "./App.css";
import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { usePadStore } from "./store/padStore";
import { DeviceScanner } from "./components/DeviceScanner";
import { Dashboard } from "./components/Dashboard";

const appWindow = getCurrentWindow();

function App() {
  const connectionState = usePadStore((s) => s.connectionState);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    appWindow.onFocusChanged(({ payload: focused }) => {
      if (!focused) appWindow.hide();
    }).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  return connectionState === "connected" ? <Dashboard /> : <DeviceScanner />;
}

export default App;
