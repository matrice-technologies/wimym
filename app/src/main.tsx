import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./styles.css";
import Shell from "./components/Shell";
import { TipProvider } from "./components/Tip";
import { DataProvider } from "./lib/data";
import Portrait from "./pages/Portrait";
import Days from "./pages/Days";
import DayPage from "./pages/Day";
import Messages from "./pages/Messages";
import Lead from "./pages/Lead";
import Voice from "./pages/Voice";
import Projects from "./pages/Projects";
import TheirView from "./pages/TheirView";
import Labels from "./pages/Labels";
import ThisWeek from "./pages/ThisWeek";
import WeekRetro from "./pages/WeekRetro";
import Practices from "./pages/Practices";
import NotFound from "./pages/NotFound";

const router = createBrowserRouter([
  {
    path: "/", element: <Shell />, children: [
      { index: true, element: <ThisWeek /> },
      { path: "week", element: <WeekRetro /> },
      { path: "practices", element: <Practices /> },
      { path: "portrait", element: <Portrait /> },
      { path: "days", element: <Days /> },
      { path: "days/:day", element: <DayPage /> },
      { path: "messages", element: <Messages /> },
      { path: "messages/:id", element: <Messages /> },
      { path: "lead", element: <Lead /> },
      { path: "voice", element: <Voice /> },
      { path: "projects", element: <Projects /> },
      { path: "their-view", element: <TheirView /> },
      { path: "labels", element: <Labels /> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DataProvider>
      <TipProvider>
        <RouterProvider router={router} />
      </TipProvider>
    </DataProvider>
  </StrictMode>,
);
