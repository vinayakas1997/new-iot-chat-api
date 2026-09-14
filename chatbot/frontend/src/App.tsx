import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import { Shell } from "./shell/Shell";
import { Chat } from "./screens/Chat";
import { Schedules } from "./screens/Schedules";
import { Briefings } from "./screens/Briefings";

const router = createBrowserRouter([
  { path: "/", element: <Navigate to="/rag/chat" replace /> },
  {
    path: "/rag",
    element: <Shell />,
    children: [
      { index: true, element: <Navigate to="chat" replace /> },
      { path: "chat", element: <Chat /> },
      { path: "schedules", element: <Schedules /> },
      { path: "briefings", element: <Briefings /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
