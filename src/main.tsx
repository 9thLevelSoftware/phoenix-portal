
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import { QueryProvider } from "./providers/QueryProvider";
  import "./styles/index.css";

  createRoot(document.getElementById("root")!).render(
    <QueryProvider>
      <App />
    </QueryProvider>
  );
