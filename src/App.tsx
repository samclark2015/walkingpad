import "./App.css";
import { usePadStore } from "./store/padStore";
import { DeviceScanner } from "./components/DeviceScanner";
import { Dashboard } from "./components/Dashboard";

function App() {
  const connectionState = usePadStore((s) => s.connectionState);

  return connectionState === "connected" ? <Dashboard /> : <DeviceScanner />;
}

export default App;
