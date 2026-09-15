import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { Shell } from "./shell/Shell";
import { Connections } from "./screens/Connections";
import { Cards } from "./screens/Cards";
import { Hindsight } from "./screens/Hindsight";
import { History } from "./screens/History";
import { AiLogs } from "./screens/AiLogs";
import { Lines } from "./screens/Lines";
import { Home, Placeholder } from "./screens/misc";

const router = createBrowserRouter([
  { path: "/", element: <Home /> },
  {
    path: "/setter",
    element: <Shell />,
    children: [
      { index: true, element: <Navigate to="connections" replace /> },
      { path: "connections", element: <Connections /> },
      { path: "lines", element: <Lines /> },
      { path: "cards", element: <Cards /> },
      { path: "history", element: <History /> },
      { path: "hindsight", element: <Hindsight /> },
      { path: "ai-logs", element: <AiLogs /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
