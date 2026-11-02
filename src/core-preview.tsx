import { createRoot } from "react-dom/client";
import CorePreview from "./components/CorePreview";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-700.css";
import "./core-preview.css";

createRoot(document.getElementById("root")!).render(<CorePreview />);
