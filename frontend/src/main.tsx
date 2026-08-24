import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import Landing from "./pages/Landing";
import Chat from "./pages/Chat";
import Quiz from "./pages/Quiz";
import Tools from "./pages/Tools"
import FlashCards from './pages/FlashCards'
import ExamLabs from "./pages/examlab.tsx";
import NotFound from './pages/404.tsx'
import PlannerPage from './pages/Planner'
import Debate from './pages/Debate'
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import { AuthProvider } from "./components/AuthProvider";
import RequireAuth from "./components/RequireAuth";
import "./index.css"

ReactDOM.createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route
          path="/"
          element={(
            <RequireAuth>
              <App />
            </RequireAuth>
          )}
        >
          <Route index element={<Landing />} />
          <Route path="chat" element={<Chat />} />
          <Route path="quiz" element={<Quiz />} />
          <Route path="tools" element={<Tools />} />
          <Route path="planner" element={<PlannerPage />} />
          <Route path="debate" element={<Debate />} />
          <Route path="cards" element={<FlashCards />} />
          <Route path="exam" element={<ExamLabs />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </AuthProvider>
  </BrowserRouter>
);