
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import { AuthProvider } from "./providers/AuthProvider";
  import { QueryProvider } from "./providers/QueryProvider";
  import "./styles/index.css";

  createRoot(document.getElementById("root")!).render(
    <AuthProvider>
      <QueryProvider>
        <App />
      </QueryProvider>
    </AuthProvider>
  );
